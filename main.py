import os
import math
import asyncio
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from web3 import AsyncWeb3
from web3.providers import AsyncHTTPProvider
from web3 import Web3

app = FastAPI(title="LFJ Liquidity Book Explorer")

# ABI definitions
LB_PAIR_ABI = [
    {
        "inputs": [],
        "name": "getTokenX",
        "outputs": [{"internalType": "address", "name": "tokenX", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getTokenY",
        "outputs": [{"internalType": "address", "name": "tokenY", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getBinStep",
        "outputs": [{"internalType": "uint16", "name": "", "type": "uint16"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getActiveId",
        "outputs": [{"internalType": "uint24", "name": "", "type": "uint24"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "uint24", "name": "id", "type": "uint24"}],
        "name": "getBin",
        "outputs": [
            {"internalType": "uint128", "name": "binReserveX", "type": "uint128"},
            {"internalType": "uint128", "name": "binReserveY", "type": "uint128"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

ERC20_ABI = [
    {
        "inputs": [],
        "name": "name",
        "outputs": [{"internalType": "string", "name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [{"internalType": "string", "name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function"
    }
]

MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"
MULTICALL_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {"name": "target", "type": "address"},
                    {"name": "allowFailure", "type": "bool"},
                    {"name": "callData", "type": "bytes"}
                ],
                "name": "calls",
                "type": "tuple[]"
            }
        ],
        "name": "aggregate3",
        "outputs": [
            {
                "components": [
                    {"name": "success", "type": "bool"},
                    {"name": "returnData", "type": "bytes"}
                ],
                "name": "returnData",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "payable",
        "type": "function"
    }
]

DEFAULT_RPC = "https://api.avax.network/ext/bc/C/rpc"

# Ensure static folder exists
os.makedirs("static", exist_ok=True)

def price_to_bin_id(price_readable, bin_step, decimals_x, decimals_y):
    # p_raw = price_readable * 10**(decimals_y - decimals_x)
    p_raw = price_readable * (10 ** (decimals_y - decimals_x))
    step_ratio = 1.0 + (bin_step / 10000.0)
    # Solve (step_ratio)**(bin_id - 8388608) = p_raw
    bin_offset = math.log(p_raw) / math.log(step_ratio)
    return bin_offset + 8388608

def bin_id_to_price(bin_id, bin_step, decimals_x, decimals_y):
    step_ratio = 1.0 + (bin_step / 10000.0)
    p_raw = step_ratio ** (bin_id - 8388608)
    price_readable = p_raw / (10 ** (decimals_y - decimals_x))
    return price_readable

@app.get("/api/pool_info")
async def get_pool_info(
    pool_address: str = Query(..., description="LBPair Contract Address"),
    min_price: float = Query(..., description="Minimum price of the range"),
    max_price: float = Query(..., description="Maximum price of the range"),
    rpc_url: str = Query(DEFAULT_RPC, description="Avalanche C-Chain RPC URL")
):
    # 1. Address Validation
    try:
        checksum_pool = Web3.to_checksum_address(pool_address)
    except ValueError:
        raise HTTPException(status_code=400, detail="無效的合約地址格式，請輸入正確的以太坊地址。")

    if min_price <= 0 or max_price <= 0:
        raise HTTPException(status_code=400, detail="價格區間必須大於 0。")

    if min_price > max_price:
        min_price, max_price = max_price, min_price

    # 2. Web3 connection
    w3 = AsyncWeb3(AsyncHTTPProvider(rpc_url))
    if not await w3.is_connected():
        raise HTTPException(status_code=502, detail="無法連線至指定的 RPC 節點，請檢查網路或 RPC 網址。")

    lb_pair_contract = w3.eth.contract(address=checksum_pool, abi=LB_PAIR_ABI)
    multicall_contract = w3.eth.contract(address=MULTICALL_ADDRESS, abi=MULTICALL_ABI)

    # 3. Fetch LBPair Metadata
    try:
        calls1 = [
            {"target": checksum_pool, "allowFailure": False, "callData": lb_pair_contract.encode_abi("getTokenX")},
            {"target": checksum_pool, "allowFailure": False, "callData": lb_pair_contract.encode_abi("getTokenY")},
            {"target": checksum_pool, "allowFailure": False, "callData": lb_pair_contract.encode_abi("getBinStep")},
            {"target": checksum_pool, "allowFailure": False, "callData": lb_pair_contract.encode_abi("getActiveId")}
        ]
        res1 = await multicall_contract.functions.aggregate3(calls1).call()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"讀取合約失敗。此合約可能非有效的 LFJ LB Pair，或者 RPC 發生錯誤。詳情: {str(e)}"
        )

    token_x_address = w3.codec.decode(["address"], res1[0][1])[0]
    token_y_address = w3.codec.decode(["address"], res1[1][1])[0]
    bin_step = w3.codec.decode(["uint16"], res1[2][1])[0]
    active_id = w3.codec.decode(["uint24"], res1[3][1])[0]

    # 4. Fetch Token details
    checksum_x = Web3.to_checksum_address(token_x_address)
    checksum_y = Web3.to_checksum_address(token_y_address)
    token_x_contract = w3.eth.contract(address=checksum_x, abi=ERC20_ABI)
    token_y_contract = w3.eth.contract(address=checksum_y, abi=ERC20_ABI)

    try:
        calls2 = [
            {"target": checksum_x, "allowFailure": True, "callData": token_x_contract.encode_abi("name")},
            {"target": checksum_x, "allowFailure": True, "callData": token_x_contract.encode_abi("symbol")},
            {"target": checksum_x, "allowFailure": True, "callData": token_x_contract.encode_abi("decimals")},
            {"target": checksum_y, "allowFailure": True, "callData": token_y_contract.encode_abi("name")},
            {"target": checksum_y, "allowFailure": True, "callData": token_y_contract.encode_abi("symbol")},
            {"target": checksum_y, "allowFailure": True, "callData": token_y_contract.encode_abi("decimals")}
        ]
        res2 = await multicall_contract.functions.aggregate3(calls2).call()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取代幣資訊失敗。詳情: {str(e)}")

    name_x = w3.codec.decode(["string"], res2[0][1])[0] if res2[0][0] and len(res2[0][1]) > 0 else "Unknown"
    symbol_x = w3.codec.decode(["string"], res2[1][1])[0] if res2[1][0] and len(res2[1][1]) > 0 else "Token X"
    decimals_x = w3.codec.decode(["uint8"], res2[2][1])[0] if res2[2][0] and len(res2[2][1]) > 0 else 18

    name_y = w3.codec.decode(["string"], res2[3][1])[0] if res2[3][0] and len(res2[3][1]) > 0 else "Unknown"
    symbol_y = w3.codec.decode(["string"], res2[4][1])[0] if res2[4][0] and len(res2[4][1]) > 0 else "Token Y"
    decimals_y = w3.codec.decode(["uint8"], res2[5][1])[0] if res2[5][0] and len(res2[5][1]) > 0 else 18

    # 5. Bin range math
    try:
        bin_id_min_exact = price_to_bin_id(min_price, bin_step, decimals_x, decimals_y)
        bin_id_max_exact = price_to_bin_id(max_price, bin_step, decimals_x, decimals_y)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"價格區間轉換 binId 失敗，請確認輸入數值是否過大或過小。")

    bin_id_min = math.floor(bin_id_min_exact)
    bin_id_max = math.ceil(bin_id_max_exact)

    # Handle sorting order if min/max bin ids are flipped due to negative exponent math
    if bin_id_min > bin_id_max:
        bin_id_min, bin_id_max = bin_id_max, bin_id_min

    num_bins = bin_id_max - bin_id_min + 1

    MAX_BINS_LIMIT = 2000
    if num_bins > MAX_BINS_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"查詢區間內的價格點 (Bin) 數量達 {num_bins} 個，超過系統安全上限 {MAX_BINS_LIMIT} 個。請縮小價格區間以避免 RPC 請求逾時。"
        )

    # 6. Fetch Bins Reserves (Batch query)
    calls3 = []
    for b_id in range(bin_id_min, bin_id_max + 1):
        call_data = lb_pair_contract.encode_abi("getBin", args=[b_id])
        calls3.append({
            "target": checksum_pool,
            "allowFailure": True,
            "callData": call_data
        })

    # Chunk multicall calls to avoid payload size limit issues
    chunk_size = 500
    res3 = []
    try:
        for i in range(0, len(calls3), chunk_size):
            chunk = calls3[i:i+chunk_size]
            chunk_res = await multicall_contract.functions.aggregate3(chunk).call()
            res3.extend(chunk_res)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"批次查詢 Bin Reserves 失敗。RPC 連線異常。詳情: {str(e)}")

    # Decode and compile response
    bins_data = []
    total_reserve_x = 0.0
    total_reserve_y = 0.0

    for idx, (success, return_data) in enumerate(res3):
        b_id = bin_id_min + idx
        price = bin_id_to_price(b_id, bin_step, decimals_x, decimals_y)

        reserve_x_raw = 0
        reserve_y_raw = 0

        if success and return_data:
            try:
                reserve_x_raw, reserve_y_raw = w3.codec.decode(["uint128", "uint128"], return_data)
            except Exception:
                pass

        reserve_x = reserve_x_raw / (10 ** decimals_x)
        reserve_y = reserve_y_raw / (10 ** decimals_y)

        total_reserve_x += reserve_x
        total_reserve_y += reserve_y

        bins_data.append({
            "binId": b_id,
            "price": price,
            "reserveX": reserve_x,
            "reserveY": reserve_y,
            "isActive": b_id == active_id
        })

    active_price = bin_id_to_price(active_id, bin_step, decimals_x, decimals_y)

    return {
        "pool": {
            "address": checksum_pool,
            "binStep": bin_step,
            "activeId": active_id,
            "activePrice": active_price
        },
        "tokenX": {
            "address": token_x_address,
            "name": name_x,
            "symbol": symbol_x,
            "decimals": decimals_x
        },
        "tokenY": {
            "address": token_y_address,
            "name": name_y,
            "symbol": symbol_y,
            "decimals": decimals_y
        },
        "queryRange": {
            "minPrice": min_price,
            "maxPrice": max_price,
            "binIdMin": bin_id_min,
            "binIdMax": bin_id_max,
            "numBins": num_bins
        },
        "reserves": {
            "totalX": total_reserve_x,
            "totalY": total_reserve_y
        },
        "bins": bins_data
    }

# Mount static folder
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
