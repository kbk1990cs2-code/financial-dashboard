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
        console.error('❌ KIS 접속키 발급 실패 (AppSecret을 확인하세요):', error.response ? error.response.data : error.message);
    }
}

// KIS 실시간 웹소켓 서버 접속
function connectToKisWs() {
    if (!wsApprovalKey) return;
    
    // 실전투자 KOSPI 실시간 체결가 엔드포인트: ws://ops.koreainvestment.com:21000/tryitout/H0STCNT0
    kisWs = new WebSocket(`${KIS_WS_URL}/tryitout/H0STCNT0`);
    
    kisWs.on('open', () => {
        console.log('✅ KIS 실시간 서버 연결됨');
        // KOSPI 지수 추종 ETF(KODEX 200)로 완벽하게 주식 API 호환
        const req = {
            header: {
                approval_key: wsApprovalKey,
                custtype: "P",
                tr_type: "1",
                "content-type": "utf-8"
            },
            body: {
                input: {
                    tr_id: "H0STCNT0", // 국내주식 실시간 체결
                    tr_key: "069500"   // KODEX 200
                }
            }
        };
        kisWs.send(JSON.stringify(req));
    });

    kisWs.on('message', (data) => {
        const msg = data.toString('utf-8');
        console.log("WS MSG:", msg);
        if (msg.includes('PING')) {
            kisWs.pong();
            return;
        }

        // 실시간 체결 데이터 파싱
        // 예: 0|H0STCNT0|001|069500^...
        const parts = msg.split('|');
        if (parts.length >= 4) {
            const trid = parts[1];
            if (trid === 'H0STCNT0') {
                const dataParts = parts[3].split('^');
                if (dataParts.length > 2) {
                    const price = parseFloat(dataParts[2]); // 현재가
                    
                    // 클라이언트(프론트엔드)로 데이터 브로드캐스팅
                    const payload = JSON.stringify({ type: 'price_update', id: 'kospi', price: price });
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(payload);
                        }
                    });
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

// 초기 키 발급 실행
getAccessToken();
getApprovalKey();

// 과거 데이터(분봉/일봉) 조회 API 엔드포인트
app.get('/api/history/:id', async (req, res) => {
    if (!accessToken) return res.status(500).json({ error: 'Token not ready' });
    
    const id = req.params.id;
    let iscd = '';
    // 코스피를 KODEX 200 ETF로 매핑하여 조회
    if (id === 'kospi') iscd = '069500';
    else return res.json([]);

    try {
        // 국내주식 일별 시세 API
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
                FID_PERIOD_DIV_CODE: 'D', // 일봉
                FID_ORG_ADJ_PRC: '0'
            }
        });

        const history = [];
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
        res.json(history);
    } catch (err) {
        console.error('❌ History fetch error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// 클라이언트(웹) 접속 처리
wss.on('connection', (ws) => {
    console.log('💻 클라이언트 접속됨');
    ws.on('close', () => console.log('💻 클라이언트 접속 해제됨'));
});

server.listen(8080, () => {
    console.log('🚀 로컬 중계 서버 실행 중: ws://localhost:8080');
});
