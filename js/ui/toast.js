// トースト通知（sim の 'message'）
const ICON = { info: 'i', good: '✔', bad: '⚠', money: '$', star: '★', event: '!', complaint: '…' };
const MAX = 3;

export class Toasts {
  constructor(app, el) {
    this.app = app;
    this.el = el;
  }

  show(m) {
    if (!m || !m.text) return;
    const kind = m.kind || 'info';
    // 同じ文面が表示中なら回数だけ増やす（倍速時の連打対策）
    for (const t of this.el.children) {
      if (t._text === m.text && !t.classList.contains('is-out')) {
        t._count = (t._count || 1) + 1;
        t.querySelector('.t-text').textContent = `${m.text} ×${t._count}`;
        this.arm(t, kind);
        return;
      }
    }
    const t = document.createElement('div');
    t.className = `toast k-${kind}`;
    t._text = m.text;
    const icon = document.createElement('span');
    icon.className = 't-icon';
    icon.textContent = ICON[kind] || 'i';
    const tx = document.createElement('span');
    tx.className = 't-text';
    tx.textContent = m.text;
    t.append(icon, tx);
    const jump = Number.isFinite(m.f) && Number.isFinite(m.x);
    if (jump) {
      // トースト自体はクリックを通す（下のキャンバスを操作できるように）。ボタンだけ押せる
      const go = document.createElement('button');
      go.className = 't-go';
      go.textContent = '見に行く ▶';
      go.title = 'その場所へ移動';
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.jumpTo(m.f, m.x);
        this.dismiss(t);
      });
      t.append(go);
    }
    this.el.prepend(t);
    while (this.el.children.length > MAX) this.el.lastElementChild.remove();
    this.arm(t, kind);
  }

  arm(t, kind) {
    clearTimeout(t._timer);
    const ms = kind === 'event' || kind === 'bad' || kind === 'star' ? 7000 : kind === 'complaint' ? 6000 : 4500;
    t._timer = setTimeout(() => this.dismiss(t), ms);
  }

  dismiss(t) {
    if (!t.isConnected || t.classList.contains('is-out')) return;
    t.classList.add('is-out');
    setTimeout(() => t.remove(), 260);
  }

  clear() { this.el.textContent = ''; }
}
