/* Desert Vanguard play-menu enhancements. Appended to the site script by scripts/brand/apply.py.
   The real <select> and <input> elements stay in the form (hidden), so submitting works exactly as before. */
(() => {
  try {
    const form = document.getElementById("quick-match");
    if (!form) return;
    const sel = form.querySelector('select[name="map"]');
    const diff = form.querySelector('select[name="difficulty"]');
    const bots = [form.querySelector('input[name="bots_team0"]'), form.querySelector('input[name="bots_team1"]')];
    const two = form.querySelector(".two");
    if (!two) return;
    const el = (tag, cls, parent, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      if (parent) parent.append(e);
      return e;
    };
    const fire = (node) => node.dispatchEvent(new Event("change", { bubbles: true }));

    // the map: a thumbnail for each
    let maps = null;
    if (sel) {
      maps = el("div", "dv-maps");
      maps.setAttribute("role", "radiogroup");
      maps.setAttribute("aria-label", "Map");
      const btns = [...sel.options].map((o) => {
        const b = el("button", "dv-map", maps);
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset.v = o.value;
        const im = el("img", "", b);
        im.src = `/assets/brand/${o.value}.webp`;
        im.alt = "";
        im.loading = "lazy";
        im.addEventListener("error", () => im.remove());
        el("span", "", b, o.textContent);
        b.addEventListener("click", () => {
          if (sel.value !== o.value) {
            sel.value = o.value;
            fire(sel);
          }
          sync();
        });
        return b;
      });
      const sync = () => {
        for (const b of btns) {
          const on = b.dataset.v === sel.value;
          b.classList.toggle("on", on);
          b.setAttribute("aria-checked", String(on));
        }
      };
      sel.addEventListener("change", sync);
      sync();
    }

    // difficulty as buttons, the bot counts as steppers
    const row = el("div", "dv-row");
    if (diff) {
      const f = el("div", "dv-field", row);
      el("b", "", f, "Difficulty");
      const seg = el("div", "dv-seg", f);
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", "Difficulty");
      const items = [...diff.options].map((o) => {
        const b = el("button", "", seg, o.textContent);
        b.type = "button";
        b.setAttribute("role", "radio");
        b.addEventListener("click", () => {
          diff.value = o.value || o.textContent;
          fire(diff);
          sync();
        });
        return [b, o];
      });
      const sync = () => {
        for (const [b, o] of items) {
          const on = (o.value || o.textContent) === diff.value;
          b.classList.toggle("on", on);
          b.setAttribute("aria-checked", String(on));
        }
      };
      sync();
    }
    const names = ["Bots, attackers", "Bots, defenders"];
    bots.forEach((inp, i) => {
      if (!inp) return;
      const f = el("div", "dv-field", row);
      el("b", "", f, names[i]);
      const st = el("div", "dv-step", f);
      const min = Number(inp.min || 0), max = Number(inp.max || 8);
      const dec = el("button", "", st, "−");
      const out = el("output", "", st);
      const inc = el("button", "", st, "+");
      dec.type = inc.type = "button";
      dec.setAttribute("aria-label", `Fewer: ${names[i].toLowerCase()}`);
      inc.setAttribute("aria-label", `More: ${names[i].toLowerCase()}`);
      const set = (v) => {
        v = Math.max(min, Math.min(max, v));
        inp.value = String(v);
        out.textContent = String(v);
        dec.disabled = v <= min;
        inc.disabled = v >= max;
      };
      dec.addEventListener("click", () => set(Number(inp.value || 0) - 1));
      inc.addEventListener("click", () => set(Number(inp.value || 0) + 1));
      set(Number(inp.value || 0));
    });
    two.before(...(maps ? [maps, row] : [row]));
    two.classList.add("dv-hide");

    // the banner shows the selected map's description
    const desc = document.getElementById("featured-map-desc");
    if (desc && sel) {
      const show = () => {
        const card = document.querySelector(`.map-card[data-map="${CSS.escape(sel.value)}"]`);
        const p = card ? [...card.querySelectorAll("p")].find((x) => !x.classList.contains("muted")) : null;
        desc.textContent = p ? p.textContent : "";
      };
      sel.addEventListener("change", show);
      show();
    }
  } catch (e) {
    console.warn("menu enhancements skipped", e);
  }
})();
