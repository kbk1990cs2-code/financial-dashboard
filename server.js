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
let kisWs = null;

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
        // 실전투자 국내업종 지수 실시간 체결가 구독 (코스피: 0001)
        const req = {
            header: {
                approval_key: wsApprovalKey,
                custtype: "P",
                tr_type: "1", // 1: 등록, 2: 해제
                "content-type": "utf-8"
            },
            body: {
                input: {
                    tr_id: "H0UPCNT0", // 국내지수 실시간체결
                    tr_key: "0001"     // 코스피 지수
                }
            }
        };
        kisWs.send(JSON.stringify(req));
    });

    kisWs.on('message', (data) => {
        const msg = data.toString('utf-8');
        
        // PING/PONG 처리
        if (msg.includes('PINGPONG')) {
            // KIS 서버에서 핑이 오면 무시하거나 퐁 처리
            return;
        }

        // 실시간 지수 체결 데이터 파싱
        // 예: 0|H0UPCNT0|001|0001^104840^2581.68^2^...
        const parts = msg.split('|');
        if (parts.length >= 4) {
            const trid = parts[1];
            if (trid === 'H0UPCNT0') {
                const dataParts = parts[3].split('^');
                if (dataParts.length > 2) {
                    const price = parseFloat(dataParts[2]); // 현재가 지수
                    
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
getApprovalKey();

// 클라이언트(웹) 접속 처리
wss.on('connection', (ws) => {
    console.log('💻 클라이언트 접속됨');
    ws.on('close', () => console.log('💻 클라이언트 접속 해제됨'));
});

server.listen(8080, () => {
    console.log('🚀 로컬 중계 서버 실행 중: ws://localhost:8080');
});
