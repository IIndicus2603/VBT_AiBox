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
        // videoWidth/Height chỉ có sau frame đầu -> 'resize' là mốc "đã có hình"
        this.video.addEventListener('resize', () => {
            if (this.video.videoHeight) this.emit('live', {mode: this.playMode});
        });
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
        this.emit('idle');   // tạm dừng có chủ ý, KHÔNG phải lỗi
    }
}

customElements.define('video-stream', VideoStream);
