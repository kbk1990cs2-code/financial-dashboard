import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const KIS_API_URL = process.env.KIS_API_URL;
const KIS_WS_URL = process.env.KIS_WS_URL;
const APP_KEY = process.env.KIS_APP_KEY;
const APP_SECRET = process.env.KIS_APP_SECRET;

let wsApprovalKey = null;
let accessToken = null;
let kisWs = null;

// 종목 매핑 (모든 지수를 ETF로 매핑)
const tickerMap = {
    'kospi': '069500',  // KODEX 200
    'nasdaq': '133690', // TIGER 미국나스닥100
    'snp500': '360750', // TIGER 미국S&P500
    'dow': '245340',    // TIGER 미국다우존스30
    'dax': '195930',    // TIGER 유로스탁스50
    'nikkei': '241180'  // TIGER 일본니케이225
};

const iscdToId = Object.keys(tickerMap).reduce((ret, key) => {
    ret[tickerMap[key]] = key;
    return ret;
}, {});

// KIS Access Token (REST API 용) 발급 함수
async function getAccessToken() {
    try {
        const response = await axios.post(`${KIS_API_URL}/oauth2/tokenP`, {
            grant_type: 'client_credentials',
            appkey: APP_KEY,
            appsecret: APP_SECRET
        });
        accessToken = response.data.access_token;
        console.log('✅ KIS Access Token 발급 성공');
    } catch (error) {
        console.error('❌ KIS Access Token 발급 실패:', error.response ? error.response.data : error.message);
    }
}

// KIS WebSocket 접속키 발급 함수
async function getApprovalKey() {
    try {
        const response = await axios.post(`${KIS_API_URL}/oauth2/Approval`, {
            grant_type: 'client_credentials',
            appkey: APP_KEY,
            secretkey: APP_SECRET
        });
        wsApprovalKey = response.data.approval_key;
        console.log('✅ KIS 접속키 발급 성공:', wsApprovalKey);
        connectToKisWs();
    } catch (error) {
        console.error('❌ KIS 접속키 발급 실패:', error.response ? error.response.data : error.message);
    }
}

// KIS 실시간 웹소켓 서버 접속
function connectToKisWs() {
    if (!wsApprovalKey) return;
    
    kisWs = new WebSocket(`${KIS_WS_URL}/tryitout/H0STCNT0`);
    
    kisWs.on('open', () => {
        console.log('✅ KIS 실시간 서버 연결됨');
        
        // 모든 ETF 종목 구독
        Object.values(tickerMap).forEach(iscd => {
            const req = {
                header: {
                    approval_key: wsApprovalKey,
                    custtype: "P",
                    tr_type: "1",
                    "content-type": "utf-8"
                },
                body: {
                    input: {
                        tr_id: "H0STCNT0",
                        tr_key: iscd
                    }
                }
            };
            kisWs.send(JSON.stringify(req));
        });
    });

    kisWs.on('message', (data) => {
        const msg = data.toString('utf-8');
        if (msg.includes('PING')) {
            kisWs.pong();
            return;
        }

        // 실시간 체결 데이터 파싱
        const parts = msg.split('|');
        if (parts.length >= 4) {
            const trid = parts[1];
            if (trid === 'H0STCNT0') {
                const dataParts = parts[3].split('^');
                if (dataParts.length > 2) {
                    const iscd = dataParts[0]; // 종목코드
                    const price = parseFloat(dataParts[2]); // 현재가
                    const id = iscdToId[iscd];
                    
                    if (id) {
                        const payload = JSON.stringify({ type: 'price_update', id: id, price: price });
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(payload);
                            }
                        });
                    }
                }
            }
        }
    });

    kisWs.on('close', () => {
        console.log('⚠️ KIS 실시간 서버 연결 종료, 재연결 시도...');
        setTimeout(connectToKisWs, 5000);
    });
    
    kisWs.on('error', (err) => {
        console.error('❌ KIS 웹소켓 에러:', err);
    });
}

// 초기 발급
getAccessToken();
getApprovalKey();

// 과거 데이터(분봉/일봉) 조회 API 엔드포인트
app.get('/api/history/:id', async (req, res) => {
    if (!accessToken) return res.status(500).json({ error: 'Token not ready' });
    
    const id = req.params.id;
    const iscd = tickerMap[id];
    if (!iscd) return res.json([]);

    const tf = req.query.tf || '1m';
    
    try {
        let history = [];
        
        // 일/주/월봉 처리
        if (['1D', '1W', '1M'].includes(tf)) {
            let divCode = 'D';
            if (tf === '1W') divCode = 'W';
            if (tf === '1M') divCode = 'M';
            
            const url = `${KIS_API_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-price`;
            const resp = await axios.get(url, {
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'authorization': `Bearer ${accessToken}`,
                    'appkey': APP_KEY,
                    'appsecret': APP_SECRET,
                    'tr_id': 'FHKST01010400'
                },
                params: {
                    FID_COND_MRKT_DIV_CODE: 'J',
                    FID_INPUT_ISCD: iscd,
                    FID_PERIOD_DIV_CODE: divCode,
                    FID_ORG_ADJ_PRC: '0'
                }
            });

            if (resp.data && resp.data.output) {
                const list = resp.data.output;
                for(let i = list.length - 1; i >= 0; i--) {
                    const item = list[i];
                    if (!item.stck_clpr) continue;
                    
                    const y = item.stck_bsop_date.substring(0, 4);
                    const m = item.stck_bsop_date.substring(4, 6);
                    const d = item.stck_bsop_date.substring(6, 8);
                    
                    const timeStr = `${y}-${m}-${d}T00:00:00+09:00`;
                    const time = Math.floor(new Date(timeStr).getTime() / 1000);
                    
                    history.push({
                        time: time,
                        open: parseFloat(item.stck_oprc),
                        high: parseFloat(item.stck_hgpr),
                        low: parseFloat(item.stck_lwpr),
                        close: parseFloat(item.stck_clpr)
                    });
                }
            }
        } 
        // 분봉 처리 (1m, 5m, 10m, 15m, 30m, 1H, 4H)
        else {
            // 당일 분봉 데이터 가져오기 (현재 시간 기준 30개)
            const url = `${KIS_API_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`;
            
            // 현재 시간을 HHMMSS 형태로 구하기 (한국 시간 기준)
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const kst = new Date(utc + (9 * 3600000));
            const hh = String(kst.getHours()).padStart(2, '0');
            const mm = String(kst.getMinutes()).padStart(2, '0');
            const ss = String(kst.getSeconds()).padStart(2, '0');
            const currentTimeStr = `${hh}${mm}${ss}`;
            
            // 단일 호출만 수행 (초당 호출 제한 방지)
            let allMinData = [];
            const resp = await axios.get(url, {
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'authorization': `Bearer ${accessToken}`,
                    'appkey': APP_KEY,
                    'appsecret': APP_SECRET,
                    'tr_id': 'FHKST03010200'
                },
                params: {
                    FID_ETC_CLS_CODE: '',
                    FID_COND_MRKT_DIV_CODE: 'J',
                    FID_INPUT_ISCD: iscd,
                    FID_INPUT_HOUR_1: currentTimeStr,
                    FID_PW_DATA_INCU_YN: 'Y'
                }
            });
            
            if (resp.data && resp.data.output2 && resp.data.output2.length > 0) {
                allMinData = resp.data.output2;
            }
            
            // KIS 분봉 데이터는 최신이 먼저 오므로 시간순(과거->최신)으로 정렬
            allMinData.reverse();
            
            // 1분봉 데이터 생성
            const min1History = [];
            for(let item of allMinData) {
                if (!item.stck_prpr) continue;
                
                const y = item.stck_bsop_date.substring(0, 4);
                const m = item.stck_bsop_date.substring(4, 6);
                const d = item.stck_bsop_date.substring(6, 8);
                const hh = item.stck_cntg_hour.substring(0, 2);
                const mm = item.stck_cntg_hour.substring(2, 4);
                const ss = item.stck_cntg_hour.substring(4, 6);
                
                const timeStr = `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`;
                const time = Math.floor(new Date(timeStr).getTime() / 1000);
                
                min1History.push({
                    time: time,
                    open: parseFloat(item.stck_oprc),
                    high: parseFloat(item.stck_hgpr),
                    low: parseFloat(item.stck_lwpr),
                    close: parseFloat(item.stck_prpr)
                });
            }
            
            // Timeframe에 맞게 집계(Aggregation)
            let groupSize = 1;
            if (tf === '5m') groupSize = 5;
            else if (tf === '10m') groupSize = 10;
            else if (tf === '15m') groupSize = 15;
            else if (tf === '30m') groupSize = 30;
            else if (tf === '1H') groupSize = 60;
            else if (tf === '4H') groupSize = 240;
            
            if (groupSize === 1) {
                history = min1History;
            } else {
                // n분봉 만들기
                for (let i = 0; i < min1History.length; i += groupSize) {
                    const chunk = min1History.slice(i, i + groupSize);
                    let high = -Infinity;
                    let low = Infinity;
                    for (let c of chunk) {
                        if (c.high > high) high = c.high;
                        if (c.low < low) low = c.low;
                    }
                    history.push({
                        time: chunk[0].time, // 시작 시간
                        open: chunk[0].open,
                        high: high,
                        low: low,
                        close: chunk[chunk.length - 1].close
                    });
                }
            }
        }
        
        res.json(history);
    } catch (err) {
        console.error(`❌ History fetch error [${id}, ${tf}]:`, err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

wss.on('connection', (ws) => {
    console.log('💻 클라이언트 접속됨');
    ws.on('close', () => console.log('💻 클라이언트 접속 해제됨'));
});

server.listen(8080, () => {
    console.log('🚀 로컬 중계 서버 실행 중: ws://localhost:8080');
});
