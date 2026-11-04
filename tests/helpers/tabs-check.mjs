// Verifies popup tab switching with REAL clicks: exactly one section visible, no overlap, no content leaking between sections.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function snap(ui) {
  return ui.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; };
    const secs = [...document.querySelectorAll('main > section')];
    const shown = secs.filter(vis);
    const rects = shown.map((s) => s.getBoundingClientRect());
    return {
      visible: shown.map((s) => s.id),
      overlap: rects.some((a, i) => rects.some((b, j) => i < j && a.top < b.bottom && b.top < a.bottom)),
      leaks: { cards: [...document.querySelectorAll('.card')].filter(vis).length, hist: [...document.querySelectorAll('.h')].filter(vis).length, settings: [...document.querySelectorAll('.set')].filter(vis).length },
      active: document.querySelector('.tab.on')?.dataset.tab,
    };
  });
}
export async function checkTabs(ui) {
  const detail = []; let ok = true;
  for (const order of [['history', 'settings', 'detected'], ['settings', 'detected', 'history'], ['detected', 'history', 'detected', 'settings', 'history', 'detected']]) {
    for (const id of order) {
      await ui.click(`.tab[data-tab="${id}"]`); await sleep(700);
      const x = await snap(ui);
      const leakOk = id === 'detected' ? x.leaks.hist === 0 && x.leaks.settings === 0 : id === 'history' ? x.leaks.cards === 0 && x.leaks.settings === 0 : x.leaks.cards === 0 && x.leaks.hist === 0;
      if (!(x.visible.length === 1 && x.visible[0] === `tab-${id}` && !x.overlap && leakOk && x.active === id)) { ok = false; detail.push(`${id}: ${JSON.stringify(x)}`); }
    }
  }
  return { ok, detail: detail.join(' | ') };
}
