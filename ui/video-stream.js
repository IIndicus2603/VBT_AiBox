import {VideoRTC} from './video-rtc.js';

/**
 * Player chỉ vẽ ĐÚNG 1 thứ: thẻ <video>. Badge/overlay do index.html vẽ ở lớp
 * ngoài -> không bao giờ chạm this.innerHTML (super.oninit() đã append
 * this.video vào đây; ghi innerHTML sẽ tách nó khỏi DOM và mọi transport sẽ
 * ghi vào một element mồ côi).
 *
 * Trạng thái đẩy ra ngoài bằng CustomEvent('state'):
 *   connecting | live | retry | error | idle
 * QUAN TRỌNG: 'idle' KHÁC 'error'. ondisconnect() của VideoRTC chỉ chạy khi bị
 * tháo có chủ ý (tile cuộn ra ngoài, đổi tab, gỡ khỏi DOM > 5s) — mất mạng thì
 * đi qua onclose() rồi tự reconnect. Coi hai cái là một sẽ báo "mất luồng" mỗi
 * lần người dùng cuộn trang.
 */
class VideoStream extends VideoRTC {
    emit(state, extra) {
        this.playState = state;
        this.dispatchEvent(new CustomEvent('state', {detail: {state, ...extra}}));
    }

    oninit() {
        super.oninit();
        this.video.controls = false;          // mặc định là true (video-rtc.js:241)
        this.stallTimeout = this.stallTimeout || 6000;   // ms không có frame -> coi là treo
        this._stallOn = false;                // watchdog tắt cho tới khi có frame đầu
        this._stallTO = 0;                    // timer phát hiện treo
        this._stallInt = 0;                   // fallback: interval poll khi không có rVFC
        this._stallLast = -1;                 // currentTime lần check trước (fallback)
        this._stallAt = 0;                    // mốc giờ cuối có frame mới (fallback)
        // videoWidth/Height chỉ có sau frame đầu -> 'resize' là mốc "đã có hình"
        this.video.addEventListener('resize', () => {
            if (this.video.videoHeight) {
                this.emit('live', {mode: this.playMode});
                this._armStall();             // có hình -> bắt đầu canh treo
            }
        });
    }

    /* ---------- watchdog: phát hiện frame đông cứng khi WS còn mở ---------- */
    // WS close / video error đã có sẵn reconnect (video-rtc.js). Nhưng nếu nguồn
    // camera treo (mất tín hiệu, đường truyền đứt) mà WS chưa đóng thì video đứng
    // yên, currentTime không tăng, không event nào bắn ra -> không bao giờ reconnect.
    // Watchdog này theo dõi frame mới: quá `stallTimeout` (ms) không có frame -> đóng
    // WS để kích hoạt đúng cơ chế reconnect sẵn có. Chỉ canh khi đang 'live'.
    // stallTimeout có thể set từ ngoài qua property; mặc định 6000ms.
    _armStall() {
        if (this._stallOn) return;
        this._stallOn = true;
        if (this.video.requestVideoFrameCallback) {
            this._frameTick = this._frameTick.bind(this);
            this.video.requestVideoFrameCallback(this._frameTick);
        } else {
            this._stallLast = this.video.currentTime;
            this._stallAt = performance.now();
            this._stallInt = setInterval(() => this._stallCheck(), 1000);
        }
        this._stallReset();
    }
    _frameTick() {
        if (!this._stallOn) return;
        this._stallReset();
        if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(this._frameTick);
    }
    _stallReset() {
        clearTimeout(this._stallTO);
        this._stallTO = setTimeout(() => this._stallDetect(), this.stallTimeout);
    }
    _stallCheck() {                              // fallback: poll currentTime
        const t = this.video.currentTime;
        if (t !== this._stallLast) { this._stallLast = t; this._stallAt = performance.now(); return; }
        if (performance.now() - this._stallAt > this.stallTimeout) this._stallDetect();
    }
    _stallDetect() {
        if (!this._stallOn || this.playState !== 'live') return;   // chỉ khi đang phát
        console.warn('[stream] stalled ' + (this.stallTimeout / 1000) + 's, reconnecting');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
        this._stallReset();
    }
    _stallDisarm() {
        this._stallOn = false;
        clearTimeout(this._stallTO);
        if (this._stallInt) { clearInterval(this._stallInt); this._stallInt = 0; }
    }

    onconnect() {
        const ok = super.onconnect();
        if (ok) this.emit('connecting');
        return ok;
    }

    onopen() {
        const ok = super.onopen();
        // onopen reset this.onmessage = {} ở mỗi lần reconnect -> gắn lại sau super
        this.onmessage['ui'] = msg => {
            if (msg.type === 'error') this.emit('error', {error: msg.value});
            else if (['mse', 'hls', 'mp4', 'mjpeg'].includes(msg.type)) this.playMode = msg.type.toUpperCase();
        };
        return ok;
    }

    onclose() {
        const retry = super.onclose();
        // ws đóng khi WebRTC thắng là chuyện bình thường -> chỉ báo khi thật sự retry
        if (retry && this.pcState !== WebSocket.OPEN) this.emit('retry');
        return retry;
    }

    onpcvideo(video) {
        super.onpcvideo(video);
        // WebRTC thua MSE thì pc bị đóng ngay trong super -> chỉ nhận 'RTC' khi pc còn sống
        if (this.pcState !== WebSocket.CLOSED) this.playMode = 'RTC';
    }

    ondisconnect() {
        super.ondisconnect();
        this.playMode = null;
        this._stallDisarm();   // ngưng có chủ ý -> dừng canh treo
        this.emit('idle');     // tạm dừng có chủ ý, KHÔNG phải lỗi
    }
}

customElements.define('video-stream', VideoStream);
