import { createChart, CrosshairMode } from 'lightweight-charts';

// 지수 메타데이터 및 상태
const indices = [
    { id: 'kospi200n', name: 'KOSPI 200 야간', sub: 'Night Futures', basePrice: 345.20, volatility: 0.4 },
    { id: 'kospi', name: '코스피', sub: 'KOSPI', basePrice: 2750.30, volatility: 2.5 },
    { id: 'kosdaq', name: '코스닥', sub: 'KOSDAQ', basePrice: 900.50, volatility: 1.5 },
    { id: 'sp500', name: 'S&P 500', sub: 'US Index', basePrice: 5102.30, volatility: 4.0 },
    { id: 'nasdaq', name: 'NASDAQ 100', sub: 'US Tech', basePrice: 17850.10, volatility: 15.0 },
    { id: 'dow', name: '다우존스', sub: 'Dow Jones', basePrice: 39000.50, volatility: 20.0 }
];

let activeIndexId = 'kospi200n';
const globalTime = Math.floor(Date.now() / 1000);

// 데이터 상태 저장소
const appState = {};

// 모든 지수에 대해 빈 데이터 셋업
indices.forEach(idx => {
    appState[idx.id] = {
        meta: idx,
        data: [],
        currentPrice: idx.basePrice,
        openPrice: idx.basePrice,
        lastCandle: null
    };
});

// 차트 설정
const chartContainer = document.getElementById('tv-chart');
const chartOptions = {
    layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#94a3b8',
    },
    grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
    },
    crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: 'rgba(255, 255, 255, 0.4)', style: 3 },
        horzLine: { width: 1, color: 'rgba(255, 255, 255, 0.4)', style: 3 },
    },
    rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.08)' },
    timeScale: { borderColor: 'rgba(255, 255, 255, 0.08)', timeVisible: true, secondsVisible: false },
};

const chart = createChart(chartContainer, chartOptions);
const candlestickSeries = chart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
    wickUpColor: '#10b981', wickDownColor: '#ef4444',
});

// 사이드바 렌더링 함수
const renderSidebar = () => {
    const listEl = document.getElementById('asset-list');
    
    // 최초 렌더링 시에만 엘리먼트 생성
    if (listEl.children.length === 0) {
        indices.forEach(idx => {
            const li = document.createElement('li');
            li.id = `asset-item-${idx.id}`;
            li.onclick = () => switchActiveIndex(idx.id);
            
            li.innerHTML = `
                <div class="asset-info">
                  <span class="asset-name">${idx.name}</span>
                  <span class="asset-sub">${idx.sub}</span>
                </div>
                <div class="asset-price">
                  <span class="price-val" id="price-val-${idx.id}"></span>
                  <span class="price-change" id="price-change-${idx.id}"></span>
                </div>
            `;
            listEl.appendChild(li);
        });
    }
    
    // 값 및 상태만 업데이트
    indices.forEach(idx => {
        const state = appState[idx.id];
        const diff = state.currentPrice - state.openPrice;
        const percent = (diff / state.openPrice) * 100;
        const isUp = diff >= 0;
        
        const li = document.getElementById(`asset-item-${idx.id}`);
        const priceContainer = li.querySelector('.asset-price');
        const priceVal = document.getElementById(`price-val-${idx.id}`);
        const priceChange = document.getElementById(`price-change-${idx.id}`);
        
        li.className = `asset-item ${activeIndexId === idx.id ? 'active' : ''}`;
        
        if (isUp) {
            priceContainer.classList.remove('down');
            priceContainer.classList.add('up');
        } else {
            priceContainer.classList.remove('up');
            priceContainer.classList.add('down');
        }
        
        priceVal.textContent = state.currentPrice.toFixed(2);
        priceChange.textContent = `${isUp ? '+' : ''}${diff.toFixed(2)} (${percent.toFixed(2)}%)`;
    });
};

// 헤더 업데이트
const updateHeaderPrice = (state) => {
    const headerTitle = document.querySelector('.header-asset-info h2');
    const priceEl = document.getElementById('header-price-val');
    const changeEl = document.getElementById('header-price-change');
    const headerEl = document.querySelector('.header-price');
    
    headerTitle.textContent = state.meta.name;
    priceEl.textContent = state.currentPrice.toFixed(2);
    
    const diff = state.currentPrice - state.openPrice;
    const percent = (diff / state.openPrice) * 100;
    
    changeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${percent.toFixed(2)}%)`;
    
    if (diff >= 0) {
        headerEl.classList.remove('down');
        headerEl.classList.add('up');
    } else {
        headerEl.classList.remove('up');
        headerEl.classList.add('down');
    }
};

// 호가창 업데이트
const updateOrderBook = (centerPrice) => {
    const asksContainer = document.getElementById('order-asks');
    const bidsContainer = document.getElementById('order-bids');
    const spreadContainer = document.querySelector('.current-spread');
    
    asksContainer.innerHTML = '';
    bidsContainer.innerHTML = '';
    spreadContainer.textContent = centerPrice.toFixed(2);
    
    for(let i = 5; i >= 1; i--) {
        const price = centerPrice + (i * 0.5);
        const size = Math.floor(Math.random() * 150) + 10;
        const row = document.createElement('div');
        row.className = 'order-row order-ask-row';
        row.innerHTML = `<span class="price">${price.toFixed(2)}</span><span class="size">${size}</span>`;
        asksContainer.appendChild(row);
    }
    
    for(let i = 1; i <= 5; i++) {
        const price = centerPrice - (i * 0.5);
        const size = Math.floor(Math.random() * 150) + 10;
        const row = document.createElement('div');
        row.className = 'order-row order-bid-row';
        row.innerHTML = `<span class="price">${price.toFixed(2)}</span><span class="size">${size}</span>`;
        bidsContainer.appendChild(row);
    }
};

// 과거 데이터 패치 함수
const fetchHistory = async (id) => {
    const state = appState[id];
    try {
        // 백엔드 URL 동적 감지 (현재 Vercel 배포 시 프록시 서버 주소 사용)
        const backendUrl = import.meta.env.VITE_WS_URL 
            ? import.meta.env.VITE_WS_URL.replace('ws', 'http') 
            : 'http://localhost:8080';
            
        const res = await fetch(`${backendUrl}/api/history/${id}`);
        const data = await res.json();
        
        if (data && data.length > 0) {
            state.data = data;
            state.currentPrice = data[data.length - 1].close;
            state.openPrice = data[0].open;
            state.lastCandle = { ...data[data.length - 1] };
        } else {
            // 코스피/코스닥 외의 지수는 임시 가상 데이터로 대체 (REST 미지원 대응)
            const fallbackData = [];
            let p = state.meta.basePrice;
            let t = globalTime - (100 * 60);
            for(let i = 0; i < 100; i++) {
                const vol = (Math.random() - 0.5) * state.meta.volatility * 3;
                const open = p, close = p + vol;
                fallbackData.push({
                    time: t, open, close,
                    high: Math.max(open, close) + Math.random(),
                    low: Math.min(open, close) - Math.random()
                });
                p = close; t += 60;
            }
            state.data = fallbackData;
            state.currentPrice = fallbackData[fallbackData.length - 1].close;
            state.openPrice = fallbackData[0].open;
            state.lastCandle = { ...fallbackData[fallbackData.length - 1] };
        }
        
        // 현재 선택된 지수라면 UI 업데이트
        if (activeIndexId === id) {
            candlestickSeries.setData(state.data);
            updateHeaderPrice(state);
            renderSidebar();
        }
    } catch (e) {
        console.error('과거 데이터 불러오기 실패:', e);
    }
};

// 활성 지수 변경
const switchActiveIndex = (id) => {
    activeIndexId = id;
    const state = appState[id];
    
    if (state.data.length === 0) {
        // 아직 과거 데이터를 안 가져왔으면 패치
        fetchHistory(id);
    } else {
        // 차트 데이터 교체
        candlestickSeries.setData(state.data);
        renderSidebar();
        updateHeaderPrice(state);
        updateOrderBook(state.currentPrice);
    }
};

// 초기 렌더링
switchActiveIndex(activeIndexId);

// 클라이언트 웹소켓 연결 (로컬 또는 원격 프록시 서버)
const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
const ws = new WebSocket(wsUrl);
ws.onopen = () => console.log(`✅ 중계 서버(${wsUrl}) 연결됨`);
ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.type === 'price_update' && data.id) {
            const state = appState[data.id];
            if (state) {
                // 실제 데이터로 가격 덮어쓰기
                state.currentPrice = data.price;
            }
        }
    } catch(e) {
        console.error('웹소켓 메시지 파싱 오류', e);
    }
};

// 메인 루프 (가상 데이터 생성 및 실시간 렌더링 통합)
setInterval(() => {
    const currentTime = Math.floor(Date.now() / 1000);
    
    // 모든 지수 업데이트
    indices.forEach(idx => {
        const state = appState[idx.id];
        // 데이터가 없으면 아직 로딩 안된 상태이므로 스킵
        if (state.data.length === 0 || !state.lastCandle) return;
        
        // kospi, kosdaq 등 실제 데이터가 들어오는 경우 틱을 더하지 않음
        if (idx.id !== 'kospi' && idx.id !== 'kosdaq') {
            const tick = (Math.random() - 0.5) * state.meta.volatility;
            state.currentPrice += tick;
        }
        
        let lastCandle = state.lastCandle;
        
        if (currentTime >= lastCandle.time + 60) {
            lastCandle = {
                time: Math.floor(currentTime / 60) * 60,
                open: state.currentPrice,
                high: state.currentPrice,
                low: state.currentPrice,
                close: state.currentPrice
            };
            state.data.push(lastCandle);
        } else {
            lastCandle.close = state.currentPrice;
            lastCandle.high = Math.max(lastCandle.high, state.currentPrice);
            lastCandle.low = Math.min(lastCandle.low, state.currentPrice);
        }
        state.lastCandle = lastCandle;
        
        // 현재 보고 있는 차트면 업데이트
        if (activeIndexId === idx.id) {
            candlestickSeries.update(lastCandle);
            updateHeaderPrice(state);
            
            if(Math.random() > 0.7) {
                updateOrderBook(state.currentPrice);
            }
        }
    });
    
    // 사이드바 UI 갱신
    renderSidebar();
    
}, 500);

window.addEventListener('resize', () => {
    chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
    });
});
