/* =============================================================
   XPERIMENT_AI / client fx + interactions
   ============================================================= */

(() => {
    "use strict";

    /* ---------- AUTH ----------
       token lives in localStorage. every fetch to /api/* gets it as a Bearer
       header via a global fetch wrapper. a 401 from any endpoint clears the
       token and bounces back to /login. */
    const AUTH_TOKEN_KEY = "xa-token";
    const AUTH_ROLE_KEY  = "xa-user-role";

    const getToken   = () => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch (e) { return null; } };
    const setToken   = (t) => { try { localStorage.setItem(AUTH_TOKEN_KEY, t); } catch (e) {} };
    const clearToken = () => {
        try {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_ROLE_KEY);
        } catch (e) {}
    };
    const setRole = (r) => { try { if (r) localStorage.setItem(AUTH_ROLE_KEY, r); } catch (e) {} };

    // decode JWT-ish token payload (no signature verify — that's server-side).
    // returns null if malformed.
    const decodeTokenPayload = (token) => {
        if (!token || !token.includes(".")) return null;
        try {
            const head = token.split(".")[0];
            const pad  = "=".repeat((4 - head.length % 4) % 4);
            const json = atob(head.replace(/-/g, "+").replace(/_/g, "/") + pad);
            return JSON.parse(json);
        } catch (e) { return null; }
    };

    const getRole = () => {
        try {
            const stored = localStorage.getItem(AUTH_ROLE_KEY);
            if (stored) return stored;
            return decodeTokenPayload(getToken())?.user || null;
        } catch (e) { return null; }
    };
    const isDev = () => getRole() === "dev";

    const isLoginPage = () => location.pathname.toLowerCase().indexOf("login") !== -1;

    // circular buffer of recent API calls — consumed by the dev HUD
    const API_CALL_LOG = [];
    const MAX_API_LOG  = 10;

    // wrap fetch so every /api/* call automatically carries the token
    const _origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : (input?.url || "");
        const isApi = url.startsWith("/api/");
        if (!isApi) return _origFetch(input, init);
        const token = getToken();
        const opts = Object.assign({}, init || {});
        opts.headers = new Headers(opts.headers || {});
        if (token) opts.headers.set("Authorization", `Bearer ${token}`);
        const method = (opts.method || "GET").toUpperCase();
        const startedAt = performance.now();
        return _origFetch(input, opts).then((resp) => {
            API_CALL_LOG.push({
                method,
                url: url.replace(/\?.*$/, ""),
                status: resp.status,
                timing: Math.round(performance.now() - startedAt),
                at: new Date(),
            });
            while (API_CALL_LOG.length > MAX_API_LOG) API_CALL_LOG.shift();
            // login endpoint can legitimately 401 — only auto-bounce for other endpoints
            if (resp.status === 401 && !url.includes("/api/login") && !isLoginPage()) {
                clearToken();
                const from = encodeURIComponent(location.pathname + location.search);
                location.replace(`/login?from=${from}`);
            }
            return resp;
        });
    };

    /* ---------- THEME TOGGLE ---------- */
    const root = document.documentElement;
    const themeBtn = document.getElementById("themeToggle");
    const themeMeta = document.getElementById("themeColorMeta");
    const THEME_KEY = "xa-theme";

    let currentSparkle = "255, 255, 255";
    const readSparkle = () => {
        const v = getComputedStyle(root).getPropertyValue("--sparkle-rgb").trim();
        if (v) currentSparkle = v;
    };

    const applyTheme = (theme, animate = true) => {
        root.setAttribute("data-theme", theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
        // cookie → so server renders the right data-theme on next navigation
        document.cookie = `xa-theme=${theme}; path=/; max-age=31536000; samesite=lax`;
        if (themeMeta) themeMeta.setAttribute("content", theme === "bloom" ? "#f1e9da" : "#050505");
        readSparkle();

        if (animate) {
            const burstX = themeBtn ? themeBtn.getBoundingClientRect().left + 40 : window.innerWidth / 2;
            const burstY = themeBtn ? themeBtn.getBoundingClientRect().top + 14  : window.innerHeight / 2;
            window.dispatchEvent(new CustomEvent("xa-burst", { detail: { x: burstX, y: burstY, count: 18 } }));
        }
    };

    // initial sparkle read (theme was set server-side in <html data-theme>)
    readSparkle();

    if (themeBtn) {
        themeBtn.addEventListener("click", () => {
            const cur = root.getAttribute("data-theme");
            // void is dev-only and exits cleanly when the chaos/bloom slider is clicked
            if (cur === "void") { applyTheme("chaos", true); return; }
            applyTheme(cur === "bloom" ? "chaos" : "bloom", true);
        });
    }

    // separate void button (dev only — JS unhides it if isDev())
    const voidBtn = document.getElementById("themeVoid");
    if (voidBtn) {
        voidBtn.addEventListener("click", () => {
            const cur = root.getAttribute("data-theme");
            if (cur === "void") {
                // return to last non-void theme, default chaos
                let prev = "chaos";
                try { prev = localStorage.getItem("xa-theme-prev") || "chaos"; } catch (e) {}
                applyTheme(prev, true);
            } else {
                try { localStorage.setItem("xa-theme-prev", cur); } catch (e) {}
                applyTheme("void", true);
            }
        });
    }

    // cross-tab sync: if another tab toggles, follow along
    window.addEventListener("storage", (e) => {
        if (e.key === THEME_KEY && e.newValue && e.newValue !== root.getAttribute("data-theme")) {
            applyTheme(e.newValue, false);
        }
    });

    /* ---------- AUTO-HIDE NAV ----------
       nav is visible only when:
         - near the top of the page (first 80px of scroll)
         - cursor is in the top hover zone of the viewport
         - cursor is over the nav itself
       any other state → hide                                       */
    const navEl = document.querySelector(".nav");
    if (navEl) {
        /* expose actual nav height as a CSS var so .main can pad-top correctly.
           the nav wraps to 2 rows on small screens, fonts load async, and the
           bloom theme uses different typography — all change the height. */
        const measureNav = () => {
            if (!navEl.classList.contains("nav--hidden")) {
                const h = navEl.offsetHeight;
                if (h > 0) document.documentElement.style.setProperty("--nav-h", h + "px");
            }
        };
        measureNav();
        window.addEventListener("resize", measureNav, { passive: true });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureNav);
        // re-measure on theme toggle (different fonts → different height)
        new MutationObserver(measureNav).observe(document.documentElement, {
            attributes: true, attributeFilter: ["data-theme"]
        });

        const SHOW_AT_TOP = 80;     // px from page top where nav is always shown
        const HOVER_ZONE  = 72;     // px from viewport top that re-shows nav
        let hovering = false;
        let nearTop = true;         // assume cursor near top on load until proven otherwise

        const update = () => {
            const aboveThreshold = window.scrollY < SHOW_AT_TOP;
            const shouldShow = aboveThreshold || hovering || nearTop;
            navEl.classList.toggle("nav--hidden", !shouldShow);
        };

        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("mousemove", (e) => {
            const wasNear = nearTop;
            nearTop = e.clientY < HOVER_ZONE;
            if (wasNear !== nearTop) update();
        }, { passive: true });
        navEl.addEventListener("mouseenter", () => { hovering = true;  update(); });
        navEl.addEventListener("mouseleave", () => { hovering = false; update(); });
    }

    /* ---------- NOISE CANVAS ---------- */
    const noise = document.getElementById("fx-noise");
    if (noise) {
        const ctx = noise.getContext("2d");
        let w, h;
        const resize = () => {
            w = noise.width = Math.floor(window.innerWidth / 2);
            h = noise.height = Math.floor(window.innerHeight / 2);
        };
        resize();
        window.addEventListener("resize", resize);

        const render = () => {
            const img = ctx.createImageData(w, h);
            const buf = img.data;
            for (let i = 0; i < buf.length; i += 4) {
                const v = (Math.random() * 255) | 0;
                buf[i] = v;
                buf[i + 1] = v;
                buf[i + 2] = v;
                buf[i + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
        };

        let last = 0;
        const loop = (t) => {
            if (t - last > 60) {
                render();
                last = t;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /* ---------- STAR CURSOR + SPARKLE TRAIL ---------- */
    const starEl = document.getElementById("cursorStar");
    const trailCanvas = document.getElementById("sparkle-trail");
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;

    if (starEl && trailCanvas && hasFinePointer) {
        const ctx2 = trailCanvas.getContext("2d");
        let cw, ch;
        const resizeTrail = () => {
            cw = trailCanvas.width = window.innerWidth;
            ch = trailCanvas.height = window.innerHeight;
        };
        resizeTrail();
        window.addEventListener("resize", resizeTrail);

        let mx = -200, my = -200;
        let sx = -200, sy = -200;

        window.addEventListener("mousemove", (e) => {
            mx = e.clientX;
            my = e.clientY;
        });

        /* sparkle particles */
        const particles = [];
        let lastSpawn = 0;

        const spawnSparkle = (x, y) => {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 18;
            particles.push({
                x: x + Math.cos(angle) * dist,
                y: y + Math.sin(angle) * dist,
                size: 1 + Math.random() * 4.5,
                alpha: 0.9 + Math.random() * 0.1,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.12,
                decay: 0.012 + Math.random() * 0.018,
                scale: 0.1,
                growing: true,
                maxScale: 0.6 + Math.random() * 0.8,
            });
        };

        /* draw a 4-pointed star centered at (0,0) */
        const drawStar4 = (ctx, size, rot) => {
            const outer = size;
            const inner = size * 0.22;
            const pts = 4;
            ctx.beginPath();
            for (let i = 0; i < pts * 2; i++) {
                const r = i % 2 === 0 ? outer : inner;
                const a = (i * Math.PI) / pts + rot;
                i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
                        : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath();
        };

        const renderTrail = (now) => {
            ctx2.clearRect(0, 0, cw, ch);

            /* spawn on move */
            if (now - lastSpawn > 28) {
                const dx = mx - sx, dy = my - sy;
                if (dx * dx + dy * dy > 4) {
                    spawnSparkle(mx, my);
                    if (Math.random() > 0.55) spawnSparkle(mx, my);
                    lastSpawn = now;
                }
            }
            sx = mx; sy = my;

            /* update + draw particles */
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                if (p.growing) {
                    p.scale += 0.06;
                    if (p.scale >= p.maxScale) p.growing = false;
                } else {
                    p.alpha -= p.decay;
                }
                p.rot += p.rotSpeed;
                if (p.alpha <= 0) { particles.splice(i, 1); continue; }

                ctx2.save();
                ctx2.translate(p.x, p.y);
                ctx2.rotate(p.rot);
                ctx2.globalAlpha = p.alpha;

                /* outer glow */
                const grd = ctx2.createRadialGradient(0, 0, 0, 0, 0, p.size * p.scale * 2.5);
                grd.addColorStop(0, `rgba(${currentSparkle}, 0.6)`);
                grd.addColorStop(1, `rgba(${currentSparkle}, 0)`);
                ctx2.fillStyle = grd;
                ctx2.beginPath();
                ctx2.arc(0, 0, p.size * p.scale * 2.5, 0, Math.PI * 2);
                ctx2.fill();

                /* sharp star */
                drawStar4(ctx2, p.size * p.scale, 0);
                ctx2.fillStyle = `rgba(${currentSparkle}, 0.95)`;
                ctx2.fill();

                ctx2.restore();
            }

            requestAnimationFrame(renderTrail);
        };
        requestAnimationFrame(renderTrail);

        /* star element follow — lag-eased */
        let ex = -200, ey = -200;
        const moveStar = () => {
            ex += (mx - ex) * 0.22;
            ey += (my - ey) * 0.22;
            starEl.style.left = ex + "px";
            starEl.style.top  = ey + "px";
            requestAnimationFrame(moveStar);
        };
        moveStar();

        /* hot state on interactive elements */
        const hotSel = "a, button, .chip, .dropzone, .portal, .generate, .director";
        document.addEventListener("mouseover", (e) => {
            if (e.target.closest(hotSel)) {
                document.body.classList.add("cursor-hot");
                for (let i = 0; i < 5; i++) spawnSparkle(mx, my);
            }
        });
        document.addEventListener("mouseout", (e) => {
            if (e.target.closest(hotSel)) document.body.classList.remove("cursor-hot");
        });

        /* click burst */
        document.addEventListener("click", () => {
            for (let i = 0; i < 12; i++) spawnSparkle(mx, my);
        });

        /* theme-toggle burst */
        window.addEventListener("xa-burst", (e) => {
            const { x, y, count } = e.detail || {};
            if (typeof x !== "number" || typeof y !== "number") return;
            for (let i = 0; i < (count || 12); i++) spawnSparkle(x, y);
        });
    }

    /* ---------- CLOCK ---------- */
    const clock = document.getElementById("navClock");
    if (clock) {
        const pad = (n) => String(n).padStart(2, "0");
        const tick = () => {
            const d = new Date();
            clock.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
        };
        tick();
        setInterval(tick, 1000);
    }

    /* ---------- RANDOM GLITCH BURSTS ---------- */
    const glitchTargets = document.querySelectorAll(".glitch");
    setInterval(() => {
        if (Math.random() > 0.7) {
            const el = glitchTargets[Math.floor(Math.random() * glitchTargets.length)];
            if (!el) return;
            el.style.transform = `translateX(${(Math.random() - 0.5) * 6}px) skewX(${(Math.random() - 0.5) * 4}deg)`;
            setTimeout(() => { el.style.transform = ""; }, 80 + Math.random() * 120);
        }
    }, 2200);

    /* ---------- CHIP STORE ----------
       chips and categories live in Vercel KV, fetched via /api/chips.
       cached in localStorage for instant first paint; the API response
       reconciles when it arrives. color/duration are special groups
       hardcoded in HTML — their fragments live in STATIC_FRAGMENTS.        */
    const API_URL          = "/api/chips";
    const CACHE_KEY        = "xa-chips-cache";
    const STATIC_GROUPS    = ["color", "duration"];
    const PAGE             = document.body.classList.contains("page-dashboard")    ? "dashboard"
                           : document.body.classList.contains("page-image")        ? "image"
                           : document.body.classList.contains("page-video")        ? "video"
                           : document.body.classList.contains("page-subscription") ? "subscription"
                           : document.body.classList.contains("page-history")      ? "history"
                           : document.body.classList.contains("page-lab")          ? "lab"
                           : null;

    // fragments for the special hardcoded groups (color swatches, duration numerics, image size)
    const STATIC_FRAGMENTS = {
        color: {
            cold_blue:     "cold blue color grade",
            warm_golden:   "warm golden hour grade",
            desaturated:   "desaturated near-monochrome",
            high_contrast: "high contrast punchy grade",
        },
        duration: {
            "5": "5s clip", "10": "10s clip",
        },
        // size + quality are API config parameters, not prompt text.
        // listed here so the readout doesn't show "undefined" for them.
        size: {
            "1:1": "", "16:9": "", "9:16": "", "21:9": "", "4:3": "", "3:4": "",
        },
        quality: {
            "draft": "", "standard": "", "pro": "", "master": "",
        },
    };

    const slugify = (s) => (s || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

    const escapeHTML = (s) => (s || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    /* in-memory copy of the entire config; one source of truth on the page. */
    let CONFIG = { categories: [], intros: {} };

    /* assembly order for the prompt. categories not in this list are appended
       after, in their natural order. some groups (size, duration) are config
       params for the API and never appear in the prompt text itself. */
    const PROMPT_ORDER       = ["theme", "style", "camera", "motion", "mood", "color"];
    const PROMPT_EXCLUDE_SET = new Set(["size", "duration", "quality"]);

    const cacheRead = () => {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    };
    const cacheWrite = (cfg) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cfg)); } catch (e) {}
    };

    const apiGet = async () => {
        const r = await fetch(API_URL, { headers: { "Accept": "application/json" } });
        if (!r.ok) throw new Error(`GET ${API_URL} -> ${r.status}`);
        return r.json();
    };
    const apiPut = async (cfg) => {
        const r = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cfg),
        });
        if (!r.ok) throw new Error(`POST ${API_URL} -> ${r.status}`);
        return r.json();
    };
    const apiReset = async () => {
        const r = await fetch(API_URL, { method: "DELETE" });
        if (!r.ok) throw new Error(`DELETE ${API_URL} -> ${r.status}`);
        return r.json();
    };

    /* debounced save: edits feel instant; one network call per ~600ms quiet period. */
    let saveTimer = null;
    let saveBusy  = false;
    const scheduleSave = (showStatus) => {
        cacheWrite(CONFIG);
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            saveBusy = true;
            showStatus?.("saving…");
            try {
                await apiPut(CONFIG);
                showStatus?.("saved");
            } catch (e) {
                showStatus?.("offline — cached locally");
            } finally {
                saveBusy = false;
            }
        }, 600);
    };

    const getFragment = (group, val) => {
        if (STATIC_FRAGMENTS[group]) return STATIC_FRAGMENTS[group][val];
        const cat = CONFIG.categories.find((c) => c.id === group);
        return cat?.chips.find((c) => c.value === val)?.fragment;
    };

    /* ---------- CHIP SELECTION + PROMPT READOUT ---------- */
    const selections    = {};
    const readout       = document.getElementById("promptReadout");
    const readoutWrap   = readout?.closest(".prompt-readout");
    const readoutReset  = document.getElementById("readoutReset");
    const director      = document.querySelector(".director");

    // when the user types in the readout, we stop overwriting it from chip changes.
    // they can hit the reset button to go back to auto-assembly.
    let userEditedPrompt = false;

    const syncReadoutChrome = () => {
        if (!readout) return;
        const isEmpty = readout.textContent.trim().length === 0;
        readout.classList.toggle("is-empty", isEmpty);
        if (readoutWrap)  readoutWrap.classList.toggle("is-edited", userEditedPrompt);
        if (readoutReset) readoutReset.hidden = !userEditedPrompt;
    };

    const renderReadout = () => {
        if (!readout) return;
        if (userEditedPrompt) { syncReadoutChrome(); return; }  // don't clobber user edits

        // assemble in canonical order: intro → theme → style → camera/motion → mood → color → director
        const parts = [];

        // intro anchors the model in our specific use case (rap music video aesthetic)
        const intro = CONFIG.intros?.[PAGE];
        if (intro) parts.push(intro);

        // ordered chip fragments
        const known      = new Set(PROMPT_ORDER);
        const ordered    = PROMPT_ORDER.filter((g) => g in selections);
        const extra      = Object.keys(selections).filter((g) => !known.has(g) && !PROMPT_EXCLUDE_SET.has(g));
        for (const group of [...ordered, ...extra]) {
            const frag = getFragment(group, selections[group]);
            if (frag) parts.push(frag);
        }

        // audio-derived pacing/energy (if a track was uploaded)
        if (typeof audioMeta !== "undefined" && audioMeta) {
            const bits = [];
            if (audioMeta.bpm)    bits.push(`synced to a ${audioMeta.bpm} BPM track`);
            if (audioMeta.energy) bits.push(`${audioMeta.energy}-energy pacing`);
            if (bits.length) parts.push(bits.join(", "));
        }

        // director's note last — most specific intent
        const note = director?.value?.trim();
        if (note) parts.push(note);

        // ". " joining reads as full sentences, which is what kling + flux prefer
        readout.textContent = parts.join(". ");
        syncReadoutChrome();
    };

    // mark as user-edited as soon as they type in the readout
    if (readout) {
        readout.addEventListener("input", () => {
            const empty = readout.textContent.trim().length === 0;
            // if they emptied the field, hand back to auto-assembly
            userEditedPrompt = !empty;
            syncReadoutChrome();
        });
        // strip formatting from pasted text (some browsers ignore plaintext-only)
        readout.addEventListener("paste", (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData)?.getData("text/plain") || "";
            // execCommand is deprecated but still the most reliable for insert-at-cursor
            // in a contenteditable. fallback inserts at end.
            try { document.execCommand("insertText", false, text); }
            catch (err) { readout.textContent = (readout.textContent || "") + text; }
        });
        // ctrl/cmd+enter from the readout fires the generate button — handy keyboard flow
        readout.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                document.getElementById("generateBtn")?.click();
            }
        });
    }

    if (readoutReset) {
        readoutReset.addEventListener("click", () => {
            userEditedPrompt = false;
            renderReadout();
            readout?.focus();
        });
    }

    /* ---------- AI PROMPT ENHANCER ----------
       sends the current readout to /api/enhance (Claude rewrites it as a
       pro-grade cinematography prompt) and replaces the readout in place.   */
    const enhanceBtn = document.getElementById("readoutEnhance");
    if (enhanceBtn) {
        enhanceBtn.addEventListener("click", async () => {
            const current = (readout?.textContent || "").trim();
            if (!current) {
                enhanceBtn.textContent = "// no prompt to enhance";
                setTimeout(() => { enhanceBtn.textContent = "✦ enhance"; }, 1800);
                return;
            }
            const original = enhanceBtn.textContent;
            enhanceBtn.disabled = true;
            enhanceBtn.textContent = "✦ enhancing…";
            try {
                const r = await fetch("/api/enhance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: current, page: PAGE || "video" }),
                });
                const data = await r.json();
                if (!r.ok || !data.enhanced) {
                    enhanceBtn.textContent = data.error ? `// ${data.error.slice(0, 30)}` : "// enhance failed";
                    setTimeout(() => { enhanceBtn.textContent = original; }, 2400);
                    return;
                }
                // replace the readout, treat as user-edited so chip changes don't clobber
                if (readout) readout.textContent = data.enhanced.trim();
                userEditedPrompt = true;
                syncReadoutChrome();
                enhanceBtn.textContent = "✦ enhanced";
                setTimeout(() => { enhanceBtn.textContent = original; }, 1600);
            } catch (err) {
                enhanceBtn.textContent = `// ${err.message?.slice(0, 30) || "network err"}`;
                setTimeout(() => { enhanceBtn.textContent = original; }, 2400);
            } finally {
                enhanceBtn.disabled = false;
            }
        });
    }

    /* ---------- PRESETS ----------
       save chip combinations as named presets, recall with one click.
       lives on the Image and Video pages.                                  */
    const presetBar  = document.getElementById("presetBar");
    const presetList = document.getElementById("presetList");
    const presetSave = document.getElementById("presetSave");

    if (presetBar && (PAGE === "image" || PAGE === "video")) {
        const renderPresets = (presets) => {
            const here = (presets || []).filter((p) => p.page === PAGE);
            if (!here.length) {
                presetList.innerHTML = '<span class="preset-empty">— none saved yet —</span>';
                return;
            }
            presetList.innerHTML = here.map((p) => `
                <span class="preset-chip" data-preset-id="${p.id}" title="${(p.director || "").slice(0, 80)}">
                    <button class="preset-apply" type="button">${escapeAttr(p.name)}</button>
                    <button class="preset-remove" type="button" aria-label="Delete preset">×</button>
                </span>`).join("");
        };

        const escapeAttr = (s) => String(s || "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const loadPresets = () => {
            fetch("/api/presets")
                .then((r) => r.ok ? r.json() : null)
                .then((d) => renderPresets(d?.presets))
                .catch(() => renderPresets([]));
        };

        const applyPreset = (presetId, presets) => {
            const p = (presets || []).find((x) => x.id === presetId);
            if (!p) return;
            // clear current selections
            Object.keys(selections).forEach((k) => delete selections[k]);
            document.querySelectorAll(".chip.is-selected").forEach((c) => c.classList.remove("is-selected"));
            // apply preset's selections
            for (const [group, val] of Object.entries(p.selections || {})) {
                selections[group] = val;
                const chip = document.querySelector(`.chip-grid[data-group="${group}"] .chip[data-value="${val}"]`);
                if (chip) chip.classList.add("is-selected");
            }
            // restore director's note
            if (director) director.value = p.director || "";
            // re-enable auto-assembly for the new state
            userEditedPrompt = false;
            renderReadout();
        };

        presetBar.addEventListener("click", async (e) => {
            const removeBtn = e.target.closest(".preset-remove");
            if (removeBtn) {
                const chip = removeBtn.closest(".preset-chip");
                const id = chip?.dataset.presetId;
                if (!id) return;
                if (!confirm("Delete this preset?")) return;
                try {
                    const r = await fetch(`/api/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
                    const d = await r.json();
                    renderPresets(d?.presets);
                } catch (err) {}
                return;
            }
            const applyBtn = e.target.closest(".preset-apply");
            if (applyBtn) {
                const id = applyBtn.closest(".preset-chip")?.dataset.presetId;
                if (!id) return;
                // fetch fresh list so we always apply the current saved data
                try {
                    const r = await fetch("/api/presets");
                    const d = await r.json();
                    applyPreset(id, d?.presets);
                } catch (err) {}
            }
        });

        if (presetSave) {
            presetSave.addEventListener("click", async () => {
                if (!Object.keys(selections).length && !director?.value?.trim()) {
                    alert("Pick some chips or write a director note before saving.");
                    return;
                }
                const name = prompt("Name this preset:");
                if (!name || !name.trim()) return;
                presetSave.disabled = true;
                const original = presetSave.textContent;
                presetSave.textContent = "saving…";
                try {
                    const r = await fetch("/api/presets", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name:       name.trim(),
                            page:       PAGE,
                            selections: { ...selections },
                            director:   director?.value || "",
                        }),
                    });
                    const d = await r.json();
                    if (!r.ok) {
                        alert("Save failed: " + (d.error || r.status));
                    } else {
                        renderPresets(d.presets);
                    }
                } catch (err) {
                    alert("Save failed: " + err.message);
                } finally {
                    presetSave.disabled = false;
                    presetSave.textContent = original;
                }
            });
        }

        loadPresets();
    }

    /* ---------- AUDIO SYNC ----------
       client-side BPM + energy detection. injects "synced to {bpm} BPM
       ({energy} energy)" into the prompt as a contextual fragment.        */
    let audioMeta = null;  // { bpm, durationSec, energy }

    const audioInput   = document.getElementById("audioUpload");
    const audioSub     = document.getElementById("audioSub");
    const audioReadout = document.getElementById("audioReadout");
    const audioBpmEl   = document.getElementById("audioBpm");
    const audioDurEl   = document.getElementById("audioDur");
    const audioEnEl    = document.getElementById("audioEnergy");
    const audioClear   = document.getElementById("audioClear");

    const detectBPM = async (file) => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error("Web Audio API not supported");
        const ctx = new Ctx();
        const arrayBuf = await file.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        const ch       = audioBuf.getChannelData(0);
        const sr       = audioBuf.sampleRate;

        // energy envelope over ~23ms windows
        const win = Math.floor(sr * 0.023);
        const energy = [];
        for (let i = 0; i < ch.length; i += win) {
            let s = 0;
            const end = Math.min(i + win, ch.length);
            for (let j = i; j < end; j++) s += ch[j] * ch[j];
            energy.push(s / (end - i));
        }

        const avg = energy.reduce((a, b) => a + b, 0) / energy.length;
        const max = Math.max(...energy);
        const threshold = avg + (max - avg) * 0.35;

        // find peaks
        const peakTimes = [];
        for (let i = 1; i < energy.length - 1; i++) {
            if (energy[i] > threshold && energy[i] > energy[i - 1] && energy[i] > energy[i + 1]) {
                peakTimes.push((i * win) / sr);
            }
        }

        // gather BPM candidates from pairwise gaps (60–200 BPM range)
        const candidates = [];
        for (let i = 0; i < peakTimes.length - 1; i++) {
            for (let j = i + 1; j < Math.min(i + 6, peakTimes.length); j++) {
                const gap = peakTimes[j] - peakTimes[i];
                if (gap < 0.3 || gap > 2.0) continue;
                let bpm = 60 / gap;
                while (bpm < 60)  bpm *= 2;
                while (bpm > 200) bpm /= 2;
                candidates.push(bpm);
            }
        }

        if (!candidates.length) {
            try { ctx.close(); } catch (e) {}
            return { bpm: null, durationSec: audioBuf.duration, energy: classifyEnergy(avg, max) };
        }

        // histogram-bucket the candidates (2-BPM bins) and pick the densest bucket
        const buckets = new Map();
        for (const c of candidates) {
            const key = Math.round(c / 2) * 2;
            buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        let bestKey = 120, bestCount = 0;
        for (const [k, v] of buckets) {
            if (v > bestCount) { bestCount = v; bestKey = k; }
        }
        try { ctx.close(); } catch (e) {}
        return { bpm: bestKey, durationSec: audioBuf.duration, energy: classifyEnergy(avg, max) };
    };

    const classifyEnergy = (avg, max) => {
        // crude heuristic — most rap masters sit in a narrow loudness band
        const ratio = max > 0 ? avg / max : 0;
        if (ratio > 0.25) return "high";
        if (ratio > 0.10) return "medium";
        return "low";
    };

    const fmtDuration = (s) => {
        if (!s || isNaN(s)) return "—";
        const m = Math.floor(s / 60);
        const sec = Math.round(s % 60);
        return `${m}:${String(sec).padStart(2, "0")}`;
    };

    if (audioInput) {
        audioInput.addEventListener("change", async () => {
            const f = audioInput.files?.[0];
            if (!f) return;
            if (f.size > 8 * 1024 * 1024) {
                if (audioSub) audioSub.textContent = "file too large (>8MB)";
                return;
            }
            if (audioSub) audioSub.textContent = `analyzing: ${f.name}`;
            try {
                const meta = await detectBPM(f);
                audioMeta = meta;
                if (audioBpmEl)   audioBpmEl.textContent   = meta.bpm ? String(meta.bpm) : "?";
                if (audioDurEl)   audioDurEl.textContent   = fmtDuration(meta.durationSec);
                if (audioEnEl)    audioEnEl.textContent    = meta.energy || "?";
                if (audioSub)     audioSub.textContent     = `loaded: ${f.name}`;
                if (audioReadout) audioReadout.hidden      = false;
                renderReadout();
            } catch (err) {
                if (audioSub) audioSub.textContent = "could not analyze (" + (err.message?.slice(0, 30) || "err") + ")";
            }
        });

        // wire the dropzone for drag-and-drop too
        const audioDrop = audioInput.closest(".dropzone");
        if (audioDrop) {
            ["dragenter", "dragover"].forEach((ev) =>
                audioDrop.addEventListener(ev, (e) => { e.preventDefault(); audioDrop.classList.add("is-drag"); })
            );
            ["dragleave", "drop"].forEach((ev) =>
                audioDrop.addEventListener(ev, (e) => { e.preventDefault(); audioDrop.classList.remove("is-drag"); })
            );
            audioDrop.addEventListener("drop", (e) => {
                const f = e.dataTransfer?.files?.[0];
                if (f && f.type.startsWith("audio/")) {
                    audioInput.files = e.dataTransfer.files;
                    audioInput.dispatchEvent(new Event("change"));
                }
            });
        }
    }

    if (audioClear) {
        audioClear.addEventListener("click", () => {
            audioMeta = null;
            if (audioInput)   audioInput.value         = "";
            if (audioReadout) audioReadout.hidden      = true;
            if (audioSub)     audioSub.textContent     = "no audio loaded";
            renderReadout();
        });
    }

    /* event delegation on the gen-grid container — handles clicks on chips
       from any panel, dynamic or static. */
    const genGrid = document.querySelector(".gen-grid");
    if (genGrid && PAGE !== "dashboard") {
        genGrid.addEventListener("click", (e) => {
            const chip = e.target.closest(".chip");
            if (!chip) return;
            const grid = chip.closest(".chip-grid");
            if (!grid) return;
            const group = grid.dataset.group;
            if (!group) return;
            e.preventDefault();
            const val = chip.dataset.value;
            if (selections[group] === val) {
                delete selections[group];
                chip.classList.remove("is-selected");
            } else {
                grid.querySelectorAll(".chip.is-selected").forEach((c) => c.classList.remove("is-selected"));
                chip.classList.add("is-selected");
                selections[group] = val;
            }
            renderReadout();
        });
    }

    if (director) director.addEventListener("input", renderReadout);

    /* ---------- RENDER PANELS ON IMAGE / VIDEO PAGES ----------
       categories whose `showOn` includes the current page get prepended
       to the gen-grid as their own gen-panel. static panels (color/
       duration/dropzone/notes) follow them in the source order. */
    const dynamicHost = document.getElementById("dynamicPanels");

    const renderGenPanels = () => {
        if (!dynamicHost || PAGE === "dashboard") return;
        const here = CONFIG.categories.filter((c) =>
            Array.isArray(c.showOn) && c.showOn.includes(PAGE)
        );
        dynamicHost.innerHTML = here.map((cat) => `
            <div class="gen-panel">
                <div class="panel-bar">
                    <span class="panel-tag"></span>
                    <span class="panel-name">// ${escapeHTML(cat.label)}</span>
                    <span class="panel-hint">${escapeHTML(cat.hint || "choose one")}</span>
                </div>
                <div class="chip-grid" data-group="${escapeHTML(cat.id)}">
                    ${cat.chips.map((c) =>
                        `<button class="chip" data-value="${escapeHTML(c.value)}">${escapeHTML(c.label)}</button>`
                    ).join("")}
                </div>
            </div>
        `).join("");
        // renumber all panels in the grid (dynamic + static)
        document.querySelectorAll(".gen-grid .gen-panel").forEach((panel, i) => {
            const tag = panel.querySelector(".panel-tag");
            if (tag) tag.textContent = String(i + 1).padStart(2, "0");
        });
    };

    /* ---------- DASHBOARD ----------
       full CRUD on categories and chips. inputs save on debounced blur. */
    const dashboardEl = document.querySelector(".dashboard");
    const dashGrid    = document.getElementById("dashGrid");
    const dashStatus  = document.getElementById("dashStatus");
    const setStatus   = (msg) => { if (dashStatus) dashStatus.textContent = msg; };

    /* collapse state — persisted in localStorage so the layout sticks across reloads */
    const DASH_COLLAPSE_KEY = "xa-dash-collapsed";
    const getCollapsed = () => {
        try {
            const raw = localStorage.getItem(DASH_COLLAPSE_KEY);
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch (e) { return new Set(); }
    };
    const saveCollapsed = (set) => {
        try { localStorage.setItem(DASH_COLLAPSE_KEY, JSON.stringify([...set])); } catch (e) {}
    };
    const isCollapsedId  = (id) => getCollapsed().has(id);
    const togglePanelCollapse = (id) => {
        const s = getCollapsed();
        if (s.has(id)) s.delete(id); else s.add(id);
        saveCollapsed(s);
    };

    const renderIntrosPanel = () => {
        const mount = document.getElementById("dashIntrosMount");
        if (!mount) return;
        const intros = CONFIG.intros || {};
        const collapsed = isCollapsedId("_intros");
        mount.innerHTML = `
            <div class="dash-intros gen-panel ${collapsed ? "is-collapsed" : ""}" data-panel-id="_intros">
                <div class="panel-bar dash-panel-bar">
                    <span class="panel-tag">¶</span>
                    <span class="panel-name">// PROMPT_INTROS</span>
                    <span class="panel-hint">base anchor prepended to every prompt</span>
                    <button class="dash-collapse-btn" type="button" aria-label="Toggle">▾</button>
                </div>
                <div class="dash-panel-body">
                    <div class="dash-intro-block">
                        <div class="dash-intro-head">
                            <span class="dash-intro-label">// IMAGE_INTRO</span>
                            <button class="dash-intro-reset" data-intro="image" type="button">reset to default</button>
                        </div>
                        <textarea class="dash-intro-text" data-intro="image" rows="4" placeholder="(empty — no intro will be prepended on the image page)">${escapeHTML(intros.image || "")}</textarea>
                    </div>
                    <div class="dash-intro-block">
                        <div class="dash-intro-head">
                            <span class="dash-intro-label">// VIDEO_INTRO</span>
                            <button class="dash-intro-reset" data-intro="video" type="button">reset to default</button>
                        </div>
                        <textarea class="dash-intro-text" data-intro="video" rows="4" placeholder="(empty — no intro will be prepended on the video page)">${escapeHTML(intros.video || "")}</textarea>
                    </div>
                </div>
            </div>`;
    };

    const renderDashboard = () => {
        if (!dashGrid) return;

        // intros panel renders independently above the grid
        renderIntrosPanel();

        // sync the static "add new category" panel's collapse state
        const newCatPanel = document.getElementById("dashNewCategory");
        if (newCatPanel) {
            newCatPanel.classList.toggle("is-collapsed", isCollapsedId("_new_cat"));
        }

        if (!CONFIG.categories.length) {
            dashGrid.innerHTML = `<div class="dash-empty">— no categories yet. add one above. —</div>`;
            return;
        }
        dashGrid.innerHTML = CONFIG.categories.map((cat, ci) => {
            const collapsed = isCollapsedId(cat.id);
            const chipCount = (cat.chips || []).length;
            return `
            <div class="dash-panel gen-panel ${collapsed ? "is-collapsed" : ""}" data-cat-id="${escapeHTML(cat.id)}" data-panel-id="${escapeHTML(cat.id)}">
                <div class="panel-bar dash-panel-bar">
                    <span class="panel-tag">${String(ci + 1).padStart(2, "0")}</span>
                    <input class="dash-cat-label" value="${escapeHTML(cat.label)}" maxlength="32" aria-label="Category label"/>
                    <span class="dash-chip-count">${chipCount} chip${chipCount === 1 ? "" : "s"}</span>
                    <button class="dash-cat-remove" type="button" aria-label="Delete category">delete</button>
                    <button class="dash-collapse-btn" type="button" aria-label="Toggle">▾</button>
                </div>
                <div class="dash-panel-body">
                    <div class="dash-cat-meta">
                        <span class="dash-cat-id">id: <code>${escapeHTML(cat.id)}</code></span>
                        <label class="dash-toggle">
                            <input type="checkbox" data-show="image" ${cat.showOn?.includes("image") ? "checked" : ""}/>
                            <span>image</span>
                        </label>
                        <label class="dash-toggle">
                            <input type="checkbox" data-show="video" ${cat.showOn?.includes("video") ? "checked" : ""}/>
                            <span>video</span>
                        </label>
                    </div>
                    <div class="dash-chips">
                        ${(cat.chips || []).map((c, i) => `
                            <div class="dash-chip" data-chip-i="${i}">
                                <div class="dash-chip-head">
                                    <input class="dash-chip-label-input" value="${escapeHTML(c.label)}" maxlength="40" aria-label="Chip label"/>
                                    <button class="dash-chip-remove" type="button" aria-label="Remove chip">×</button>
                                </div>
                                <input class="dash-chip-frag-input" value="${escapeHTML(c.fragment)}" maxlength="240" aria-label="Prompt fragment"/>
                            </div>
                        `).join("") || `<div class="dash-empty">— no chips yet. add one below. —</div>`}
                    </div>
                    <form class="dash-add">
                        <input name="label"    type="text" placeholder="NEW CHIP LABEL"            maxlength="32"  required/>
                        <input name="fragment" type="text" placeholder="prompt fragment to inject" maxlength="200" required/>
                        <button class="dash-add-btn" type="submit"><span>+ add chip</span></button>
                    </form>
                </div>
            </div>`;
        }).join("");

        updateToggleAllLabel();
    };

    // collapse-all button label flips depending on current state
    const updateToggleAllLabel = () => {
        const btn = document.getElementById("dashToggleAll");
        if (!btn) return;
        const collapsed = getCollapsed();
        // count of expandable panels (categories + intros + new_cat)
        const allIds = ["_intros", "_new_cat", ...CONFIG.categories.map((c) => c.id)];
        const anyExpanded = allIds.some((id) => !collapsed.has(id));
        btn.textContent = anyExpanded ? "collapse all" : "expand all";
    };

    const handleDashboardInput = (e) => {
        // intro textareas live outside the category panels
        if (e.target.classList.contains("dash-intro-text")) {
            const which = e.target.dataset.intro;
            CONFIG.intros = CONFIG.intros || {};
            CONFIG.intros[which] = e.target.value;
            scheduleSave(setStatus);
            return;
        }

        const panel = e.target.closest(".dash-panel");
        if (!panel) return;
        const catId = panel.dataset.catId;
        const cat = CONFIG.categories.find((c) => c.id === catId);
        if (!cat) return;

        if (e.target.classList.contains("dash-cat-label")) {
            cat.label = e.target.value;
            scheduleSave(setStatus);
            return;
        }
        if (e.target.matches('.dash-toggle input[type="checkbox"]')) {
            const which = e.target.dataset.show;
            cat.showOn = cat.showOn || [];
            const has = cat.showOn.includes(which);
            if (e.target.checked && !has) cat.showOn.push(which);
            if (!e.target.checked && has) cat.showOn = cat.showOn.filter((s) => s !== which);
            scheduleSave(setStatus);
            return;
        }
        const chipEl = e.target.closest(".dash-chip");
        if (chipEl) {
            const i = parseInt(chipEl.dataset.chipI, 10);
            const chip = cat.chips[i];
            if (!chip) return;
            if (e.target.classList.contains("dash-chip-label-input")) {
                chip.label = e.target.value;
                scheduleSave(setStatus);
            } else if (e.target.classList.contains("dash-chip-frag-input")) {
                chip.fragment = e.target.value;
                scheduleSave(setStatus);
            }
        }
    };

    const handleDashboardClick = (e) => {
        const panel = e.target.closest(".dash-panel");

        // collapse / expand a panel via its chevron button
        const collapseBtn = e.target.closest(".dash-collapse-btn");
        if (collapseBtn) {
            e.stopPropagation();
            const target = collapseBtn.closest("[data-panel-id]");
            if (!target) return;
            const id = target.dataset.panelId;
            togglePanelCollapse(id);
            target.classList.toggle("is-collapsed");
            updateToggleAllLabel();
            return;
        }

        // intro reset → restore from CONFIG._defaultIntros
        const introReset = e.target.closest(".dash-intro-reset");
        if (introReset) {
            const which = introReset.dataset.intro;
            const defaultText = (CONFIG._defaultIntros || {})[which] || "";
            CONFIG.intros = CONFIG.intros || {};
            CONFIG.intros[which] = defaultText;
            const ta = dashboardEl.querySelector(`.dash-intro-text[data-intro="${which}"]`);
            if (ta) ta.value = defaultText;
            scheduleSave(setStatus);
            return;
        }

        if (e.target.closest(".dash-chip-remove")) {
            if (!panel) return;
            const chipEl = e.target.closest(".dash-chip");
            const i = parseInt(chipEl.dataset.chipI, 10);
            const cat = CONFIG.categories.find((c) => c.id === panel.dataset.catId);
            if (!cat) return;
            cat.chips.splice(i, 1);
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        if (e.target.closest(".dash-cat-remove")) {
            if (!panel) return;
            if (!confirm(`Delete the "${panel.querySelector(".dash-cat-label").value}" category and all its chips?`)) return;
            CONFIG.categories = CONFIG.categories.filter((c) => c.id !== panel.dataset.catId);
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        if (e.target.closest("#dashResetAll")) {
            if (!confirm("Reset everything to defaults? Your custom chips will be lost.")) return;
            setStatus("resetting…");
            apiReset()
                .then((data) => { CONFIG = data; cacheWrite(CONFIG); renderDashboard(); setStatus("reset to defaults"); })
                .catch(() => setStatus("reset failed"));
        }
    };

    const handleDashboardSubmit = (e) => {
        const form = e.target.closest(".dash-add");
        if (form) {
            e.preventDefault();
            const panel = form.closest(".dash-panel");
            const cat = CONFIG.categories.find((c) => c.id === panel.dataset.catId);
            if (!cat) return;
            const labelInput = form.querySelector('[name="label"]');
            const fragInput  = form.querySelector('[name="fragment"]');
            const label = labelInput.value.trim();
            const frag  = fragInput.value.trim();
            if (!label || !frag) return;
            const value = slugify(label);
            if (!value) return;
            if (cat.chips.some((c) => c.value === value)) {
                setStatus(`"${label}" already exists in this category`);
                return;
            }
            cat.chips.push({ value, label: label.toUpperCase(), fragment: frag });
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        const newCatForm = e.target.closest("#dashNewCategory");
        if (newCatForm) {
            e.preventDefault();
            const labelInput = newCatForm.querySelector('[name="label"]');
            const hintInput  = newCatForm.querySelector('[name="hint"]');
            const onImage    = newCatForm.querySelector('[name="image"]').checked;
            const onVideo    = newCatForm.querySelector('[name="video"]').checked;
            const label = labelInput.value.trim();
            if (!label) return;
            const id = slugify(label);
            if (!id) return;
            if (CONFIG.categories.some((c) => c.id === id)) {
                setStatus(`category "${id}" already exists`);
                return;
            }
            const showOn = [];
            if (onImage) showOn.push("image");
            if (onVideo) showOn.push("video");
            CONFIG.categories.push({
                id,
                label: label.toUpperCase(),
                hint: hintInput.value.trim() || "choose one",
                showOn: showOn.length ? showOn : ["image", "video"],
                chips: [],
            });
            renderDashboard();
            scheduleSave(setStatus);
            labelInput.value = "";
            hintInput.value  = "";
        }
    };

    if (dashboardEl) {
        dashboardEl.addEventListener("input",   handleDashboardInput);
        dashboardEl.addEventListener("change",  handleDashboardInput);
        dashboardEl.addEventListener("click",   handleDashboardClick);
        dashboardEl.addEventListener("submit",  handleDashboardSubmit);

        // "collapse all" / "expand all" toggle at the top of the dashboard
        const toggleAll = document.getElementById("dashToggleAll");
        if (toggleAll) {
            toggleAll.addEventListener("click", () => {
                const allIds = ["_intros", "_new_cat", ...CONFIG.categories.map((c) => c.id)];
                const collapsed = getCollapsed();
                const anyExpanded = allIds.some((id) => !collapsed.has(id));
                if (anyExpanded) {
                    // collapse everything
                    allIds.forEach((id) => collapsed.add(id));
                } else {
                    // expand everything
                    allIds.forEach((id) => collapsed.delete(id));
                }
                saveCollapsed(collapsed);
                renderDashboard();
            });
        }
    }

    /* ---------- BOOTSTRAP ----------
       paint instantly from cache; then refresh from API in background.   */
    const paint = () => {
        if (PAGE === "dashboard") renderDashboard();
        else renderGenPanels();
    };

    const cached = cacheRead();
    if (cached?.categories) {
        CONFIG = cached;
        paint();
    }

    if (PAGE) {
        apiGet()
            .then((data) => {
                if (data?.categories) {
                    CONFIG = data;
                    cacheWrite(CONFIG);
                    paint();
                    setStatus("loaded");
                }
            })
            .catch(() => {
                if (!cached) {
                    // last-ditch: empty state, dashboard will let user add things
                    paint();
                }
                setStatus("offline mode");
            });
    }

    /* ---------- DROPZONE ---------- */
    const drop = document.querySelector(".dropzone");
    const dropSub = document.getElementById("dropSub");
    const refUpload = document.getElementById("refUpload");
    if (drop && refUpload) {
        ["dragenter", "dragover"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                drop.classList.add("is-drag");
            })
        );
        ["dragleave", "drop"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                drop.classList.remove("is-drag");
            })
        );
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer?.files?.[0];
            if (f) {
                refUpload.files = e.dataTransfer.files;
                if (dropSub) dropSub.textContent = `loaded: ${f.name}`;
            }
        });
        refUpload.addEventListener("change", () => {
            const f = refUpload.files?.[0];
            if (f && dropSub) dropSub.textContent = `loaded: ${f.name}`;
        });
    }

    /* ---------- GENERATION MODAL ----------
       opens when GENERATE/RENDER is clicked. drives the call to /api/generate
       then polls /api/status until the video is ready or fails.              */
    const modal       = document.getElementById("genModal");
    const modalStatus = document.getElementById("genModalStatus");
    const modalTimer  = document.getElementById("genModalTimer");
    const modalPrompt = document.getElementById("genModalPrompt");
    const modalResult = document.getElementById("genModalResult");
    const modalDL     = document.getElementById("genModalDownload");
    const modalError  = document.getElementById("genModalError");

    let activePollId = null;
    let activeTimerId = null;
    let modalStartedAt = 0;

    const setPane = (which) => {
        if (!modal) return;
        modal.querySelectorAll(".gen-modal-pane").forEach((p) => {
            p.hidden = (p.dataset.pane !== which);
        });
    };

    const openModal = (initialPane = "loading") => {
        if (!modal) return;
        modal.hidden = false;
        setPane(initialPane);
        document.body.style.overflow = "hidden";
    };

    const closeModal = () => {
        if (!modal) return;
        modal.hidden = true;
        document.body.style.overflow = "";
        if (activePollId) { clearTimeout(activePollId); activePollId = null; }
        if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
    };

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target.closest("[data-close-modal]")) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.hidden) closeModal();
        });
    }

    /* ---------- DOWNLOAD HANDLER ----------
       cross-origin "download" attribute is ignored by browsers, so we fetch
       the video as a blob and trigger a save from a same-origin blob: url.
       try direct (most CDNs allow CORS for videos) → fall back to our proxy. */
    const triggerSave = (blob, filename) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    };

    if (modalDL) {
        modalDL.addEventListener("click", async (e) => {
            e.preventDefault();
            const videoUrl = modalDL.dataset.videoUrl;
            const filename = modalDL.dataset.filename || "xperiment.mp4";
            if (!videoUrl) return;

            const originalLabel = modalDL.textContent;
            modalDL.textContent = "downloading…";
            modalDL.style.pointerEvents = "none";

            try {
                let blob;
                try {
                    // direct fetch from kling cdn — fast, uses native browser streaming
                    const r = await fetch(videoUrl);
                    if (!r.ok) throw new Error(`direct ${r.status}`);
                    blob = await r.blob();
                } catch (directErr) {
                    // CORS-blocked or unreachable — proxy through our backend
                    const proxyUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&name=${encodeURIComponent(filename)}`;
                    const r = await fetch(proxyUrl);
                    if (!r.ok) throw new Error(`proxy ${r.status}`);
                    blob = await r.blob();
                }
                triggerSave(blob, filename);
                modalDL.textContent = "saved ✓";
                setTimeout(() => { modalDL.textContent = originalLabel; }, 1800);
            } catch (err) {
                modalDL.textContent = `failed: ${err.message}`;
                setTimeout(() => { modalDL.textContent = originalLabel; }, 3000);
            } finally {
                modalDL.style.pointerEvents = "";
            }
        });
    }

    const formatTimer = (ms) => {
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };

    const startTimer = () => {
        modalStartedAt = Date.now();
        if (modalTimer) modalTimer.textContent = "00:00";
        activeTimerId = setInterval(() => {
            if (modalTimer) modalTimer.textContent = formatTimer(Date.now() - modalStartedAt);
        }, 500);
    };

    /* ---------- BUILD THE GENERATION REQUEST ----------
       reads the current chip selections + director note + uploaded file. */
    // whatever's currently in the readout (user-edited or auto-assembled) is the
    // final prompt — placeholder is rendered via CSS so it never leaks into textContent.
    const buildPrompt = () => (readout?.textContent || "").trim();

    const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });

    const collectRequest = async () => {
        const prompt = buildPrompt();
        const fileInput = document.getElementById("refUpload");
        const file = fileInput?.files?.[0];
        const req = {
            prompt,
            duration:    selections.duration || "5",          // video only
            aspectRatio: selections.size     || "1:1",         // image only
            quality:     selections.quality  || "standard",    // video only (defaults to v1-6 std)
            page: PAGE,
        };
        if (file) {
            // 4MB ceiling so we stay under vercel's 4.5MB body limit with overhead
            if (file.size > 4 * 1024 * 1024) {
                throw new Error("reference file too large — max 4MB on free tier");
            }
            req.reference = await readFileAsDataURL(file);
            req.referenceType = file.type.startsWith("video/") ? "video" : "image";
        }
        return req;
    };

    /* ---------- POLL /api/status UNTIL DONE ---------- */
    const POLL_INTERVAL = 5000;
    const MAX_WAIT_MS   = 5 * 60 * 1000;  // 5 minutes

    // per-page polling config — different endpoints, different result fields, different file ext
    const POLL_CONFIG = {
        video: {
            statusUrl: ({id, kind}) =>
                `/api/status?id=${encodeURIComponent(id)}&kind=${encodeURIComponent(kind)}`,
            resultKey: "videoUrl",
            mediaTag:  (url) => `<video src="${url}" controls autoplay loop playsinline></video>`,
            ext:       "mp4",
            providerName: "kling",
        },
        image: {
            // bfl routes tasks by region — pollingUrl from POST response targets
            // the exact regional endpoint where the task was created.
            statusUrl: ({id, pollingUrl}) => pollingUrl
                ? `/api/image?pollingUrl=${encodeURIComponent(pollingUrl)}`
                : `/api/image?id=${encodeURIComponent(id)}`,
            resultKey: "imageUrl",
            mediaTag:  (url) => `<img src="${url}" alt="generated image"/>`,
            ext:       "png",
            providerName: "bfl",
        },
    };

    const pollStatus = (taskInfo, startedAt, page) => {
        const cfg = POLL_CONFIG[page] || POLL_CONFIG.video;
        if (Date.now() - startedAt > MAX_WAIT_MS) {
            modalError.textContent = "render timed out after 5 minutes — try again";
            setPane("error");
            if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            return;
        }
        fetch(cfg.statusUrl(taskInfo))
            .then((r) => r.json())
            .then((data) => {
                if (data.error) {
                    modalError.textContent = data.error;
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                const mediaUrl = data[cfg.resultKey];
                if (data.status === "succeeded" && mediaUrl) {
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    const filename = `xperiment_${taskInfo.id}.${cfg.ext}`;
                    modalResult.innerHTML = cfg.mediaTag(mediaUrl);
                    modalDL.dataset.videoUrl = mediaUrl;
                    modalDL.dataset.filename = filename;
                    modalDL.removeAttribute("href");
                    modalDL.removeAttribute("download");
                    setPane("success");
                    // fire-and-forget: record this successful render in stats + history.
                    // backend dedups by taskId so repeats are harmless.
                    fetch("/api/stats", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ type: page, taskId: taskInfo.id }),
                    }).catch(() => {});
                    fetch("/api/history", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            page,
                            prompt:      buildPrompt(),
                            mediaUrl,
                            model:       page === "image" ? "flux-pro-1.1-ultra" : (selections.quality || "standard"),
                            quality:     selections.quality || "standard",
                            duration:    selections.duration || "5",
                            aspectRatio: selections.size || "1:1",
                            taskId:      taskInfo.id,
                        }),
                    }).catch(() => {});
                    return;
                }
                if (data.status === "failed") {
                    modalError.textContent = data.message || `${cfg.providerName} rejected the render`;
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                if (modalStatus) modalStatus.textContent = `// ${data.message || "rendering..."}`;
                activePollId = setTimeout(() => pollStatus(taskInfo, startedAt, page), POLL_INTERVAL);
            })
            .catch((err) => {
                modalError.textContent = `polling failed: ${err.message}`;
                setPane("error");
                if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            });
    };

    /* ---------- WIRE THE GENERATE BUTTON ---------- */
    const GENERATE_ENDPOINTS = {
        video: { url: "/api/generate", provider: "kling" },
        image: { url: "/api/image",    provider: "bfl"   },
    };

    const genBtn = document.getElementById("generateBtn");
    if (genBtn) {
        genBtn.addEventListener("click", async () => {
            const endpoint = GENERATE_ENDPOINTS[PAGE];
            if (!endpoint) {
                openModal("comingSoon");
                return;
            }

            // need at least one selection or a director note
            const prompt = buildPrompt();
            if (!prompt) {
                openModal("error");
                modalError.textContent = "pick at least one chip or write a director note";
                return;
            }

            // image page requires a size selection
            if (PAGE === "image" && !selections.size) {
                openModal("error");
                modalError.textContent = "pick an output size (album cover, landscape, etc.) before rendering";
                return;
            }

            openModal("loading");
            if (modalPrompt) modalPrompt.textContent = prompt;
            if (modalStatus) modalStatus.textContent = `// uploading signal to ${endpoint.provider}...`;
            const estEl = document.getElementById("genModalEst");
            if (estEl) estEl.textContent = PAGE === "image" ? "est: 10-30s" : "est: 60-120s";
            startTimer();

            try {
                const body = await collectRequest();
                const r = await fetch(endpoint.url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const data = await r.json();
                if (!r.ok || data.error) {
                    modalError.textContent = data.error || `server returned ${r.status}`;
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                if (modalStatus) modalStatus.textContent = PAGE === "image"
                    ? "// task accepted. waiting for pixels..."
                    : "// task accepted. waiting for frames...";
                pollStatus(
                    {
                        id: data.taskId,
                        kind: data.kind || "text2video",
                        pollingUrl: data.pollingUrl,
                    },
                    Date.now(),
                    PAGE
                );
            } catch (err) {
                modalError.textContent = err.message || "request failed";
                setPane("error");
                if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            }
        });
    }

    /* ---------- SUBSCRIPTION STATS ----------
       on the Subscription page, fetch real usage counters from /api/stats
       and replace the dash placeholders in the DOM.                       */
    if (PAGE === "subscription") {
        const statEls = {
            videos:      document.getElementById("statVideos"),
            images:      document.getElementById("statImages"),
            thisMonth:   document.getElementById("statThisMonth"),
            monthHint:   document.getElementById("statThisMonthHint"),
            memberSince: document.getElementById("statMemberSince"),
        };

        const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

        // "2026-05-14" → "may 2026"
        const fmtMemberSince = (iso) => {
            if (!iso || typeof iso !== "string") return "—";
            const m = iso.match(/^(\d{4})-(\d{2})/);
            if (!m) return "—";
            const monthIdx = parseInt(m[2], 10) - 1;
            return `${MONTHS[monthIdx] || "?"} ${m[1]}`;
        };

        // hint copy like "renders since may 1"
        const fmtMonthHint = () => {
            const now = new Date();
            return `renders since ${MONTHS[now.getMonth()]} 1`;
        };

        fetch("/api/stats")
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (!data) return;
                if (statEls.videos)      statEls.videos.textContent      = String(data.videos ?? 0);
                if (statEls.images)      statEls.images.textContent      = String(data.images ?? 0);
                if (statEls.thisMonth)   statEls.thisMonth.textContent   = String(data.currentMonth ?? 0);
                if (statEls.monthHint)   statEls.monthHint.textContent   = fmtMonthHint();
                if (statEls.memberSince) statEls.memberSince.textContent = fmtMemberSince(data.firstUse);
            })
            .catch(() => { /* offline / kv down — keep the dashes */ });
    }

    /* ---------- SUBSCRIPTION TOAST ----------
       placeholder buttons on the Subscription page surface a non-blocking
       toast since stripe isn't wired up yet. */
    const subToast = document.getElementById("subToast");
    const TOAST_MESSAGES = {
        manage: "// stripe integration coming soon · payment page will live here",
        cancel: "// cancellation flow will route through stripe customer portal",
    };
    let toastTimer = null;
    const showToast = (msg) => {
        if (!subToast) return;
        subToast.textContent = msg;
        subToast.hidden = false;
        // force reflow so the transition triggers when adding the class
        void subToast.offsetWidth;
        subToast.classList.add("is-visible");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            subToast.classList.remove("is-visible");
            setTimeout(() => { subToast.hidden = true; }, 350);
        }, 2800);
    };
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const msg = TOAST_MESSAGES[action];
        if (msg) showToast(msg);
    });

    /* ---------- LOGIN FORM ---------- */
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        // if already logged in, bounce out
        if (getToken()) {
            const from = new URLSearchParams(location.search).get("from") || "/";
            location.replace(from);
        }

        const pwInput = document.getElementById("loginPassword");
        const submit  = document.getElementById("loginSubmit");
        const errEl   = document.getElementById("loginError");

        const showErr = (msg) => {
            if (!errEl) return;
            errEl.textContent = "// " + msg;
            errEl.hidden = false;
        };
        const clearErr = () => {
            if (errEl) { errEl.hidden = true; errEl.textContent = ""; }
        };

        pwInput?.addEventListener("input", clearErr);

        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const password = (pwInput?.value || "").trim();
            if (!password) return;

            const original = submit?.querySelector(".login-submit-label")?.textContent;
            if (submit) submit.disabled = true;
            if (submit?.querySelector(".login-submit-label"))
                submit.querySelector(".login-submit-label").textContent = "VERIFYING...";

            try {
                // fetch the login endpoint directly (bypass our wrapper's redirect-on-401)
                const r = await _origFetch("/api/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password }),
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok || !data.token) {
                    showErr(data.error || "access denied");
                    if (submit) submit.disabled = false;
                    if (submit?.querySelector(".login-submit-label") && original)
                        submit.querySelector(".login-submit-label").textContent = original;
                    pwInput?.select();
                    return;
                }
                setToken(data.token);
                setRole(data.user);
                const from = new URLSearchParams(location.search).get("from") || "/";
                location.replace(from);
            } catch (err) {
                showErr(err.message || "network error");
                if (submit) submit.disabled = false;
                if (submit?.querySelector(".login-submit-label") && original)
                    submit.querySelector(".login-submit-label").textContent = original;
            }
        });
    }

    /* ---------- LOGOUT BUTTON ---------- */
    const navLogout = document.getElementById("navLogout");
    if (navLogout) {
        // hide on the login page itself — nothing to log out of
        if (isLoginPage()) navLogout.style.display = "none";
        navLogout.addEventListener("click", () => {
            clearToken();
            location.replace("/login");
        });
    }

    /* ---------- ROLE-AWARE GUARDS ----------
       remove anything operator users shouldn't see, ensure their theme can't
       be stuck on a dev-only value. */
    if (!isDev()) {
        // if a dev-themed value somehow leaked into localStorage (or they
        // logged out from dev and back in as operator), force chaos.
        if (root.getAttribute("data-theme") === "void") {
            applyTheme("chaos", false);
        }
    }

    /* ---------- DEV-ONLY FEATURES ----------
       guarded behind the "dev" role on the auth token. operator login sees
       nothing of this. badge + console HUD activated with backtick.       */
    if (isDev() && !isLoginPage()) {
        const badge = document.getElementById("navDevBadge");
        if (badge) badge.hidden = false;

        // unhide the void theme toggle
        if (voidBtn) voidBtn.hidden = false;

        // unhide the [ LAB ] nav link
        const navLab = document.getElementById("navLab");
        if (navLab) navLab.removeAttribute("hidden");

        const hud = document.getElementById("devHud");
        if (hud) {
            const fmtExp = (exp) => {
                const now = Math.floor(Date.now() / 1000);
                const diff = (exp || 0) - now;
                if (diff <= 0) return "expired";
                if (diff < 3600)  return `${Math.round(diff / 60)}m`;
                if (diff < 86400) return `${Math.round(diff / 3600)}h`;
                return `${Math.round(diff / 86400)}d`;
            };

            const inInput = (el) => {
                if (!el) return false;
                const tag = (el.tagName || "").toLowerCase();
                return tag === "input" || tag === "textarea" || el.isContentEditable;
            };

            const escapeForHTML = (s) => String(s)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            const refreshHUD = async () => {
                const payload = decodeTokenPayload(getToken());

                const setText = (id, txt) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = txt;
                };
                setText("hudUser", payload?.user || "—");
                setText("hudExp",  payload?.exp  ? fmtExp(payload.exp) : "—");
                setText("hudPage", PAGE || "(none)");

                const kvEl = document.getElementById("hudKv");
                if (kvEl) {
                    kvEl.textContent = "checking…";
                    try {
                        const t0 = performance.now();
                        const r = await fetch("/api/stats");
                        const ms = Math.round(performance.now() - t0);
                        kvEl.textContent = r.ok ? `✓ ok (${ms}ms)` : `✗ ${r.status}`;
                    } catch (e) {
                        kvEl.textContent = "✗ unreachable";
                    }
                }

                const logEl = document.getElementById("hudLog");
                if (logEl) {
                    if (!API_CALL_LOG.length) {
                        logEl.textContent = "— no requests yet —";
                    } else {
                        logEl.innerHTML = API_CALL_LOG.slice().reverse().map((c) => {
                            const statusCls = c.status >= 200 && c.status < 300 ? "ok"
                                            : c.status >= 400                   ? "err"
                                            : "warn";
                            return `<div class="dev-hud-log-row">
                                <span class="dev-hud-method">${escapeForHTML(c.method)}</span>
                                <span class="dev-hud-url">${escapeForHTML(c.url)}</span>
                                <span class="dev-hud-status dev-hud-status--${statusCls}">${c.status}</span>
                                <span class="dev-hud-timing">${c.timing}ms</span>
                            </div>`;
                        }).join("");
                    }
                }

                const selEl = document.getElementById("hudSelections");
                if (selEl) {
                    selEl.textContent = JSON.stringify(selections || {}, null, 2);
                }
            };

            const toggleHUD = () => {
                if (hud.hidden) {
                    hud.hidden = false;
                    refreshHUD();
                } else {
                    hud.hidden = true;
                }
            };

            // backtick toggles, esc closes — but only when not typing in a field
            document.addEventListener("keydown", (e) => {
                if (e.key === "`" && !inInput(e.target)) {
                    e.preventDefault();
                    toggleHUD();
                    return;
                }
                if (e.key === "Escape" && !hud.hidden) {
                    hud.hidden = true;
                }
            });

            document.getElementById("devHudClose")?.addEventListener("click", () => { hud.hidden = true; });
            document.getElementById("hudRefresh")?.addEventListener("click", refreshHUD);
            document.getElementById("hudClearLog")?.addEventListener("click", () => {
                API_CALL_LOG.length = 0;
                refreshHUD();
            });
        }
    }

    /* ---------- LAB PAGE ----------
       dev-only page at /lab. operator users get an access-denied panel.   */
    if (document.body.classList.contains("page-lab")) {
        const gate    = document.getElementById("labAccessGate");
        const content = document.getElementById("labContent");

        if (!isDev()) {
            if (gate) {
                gate.innerHTML = `
                    <div class="lab-denied gen-panel">
                        <div class="lab-denied-title">// ACCESS_DENIED</div>
                        <div class="lab-denied-msg">this area is restricted to dev sessions.</div>
                    </div>`;
            }
        } else {
            if (content) content.hidden = false;

            // ---- session info ----
            const payload = decodeTokenPayload(getToken());
            const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setText("labSesUser", payload?.user || "—");
            setText("labSesRole", getRole() || "—");
            if (payload?.exp) {
                const diffSec = payload.exp - Math.floor(Date.now() / 1000);
                const d = Math.floor(diffSec / 86400);
                const h = Math.floor((diffSec % 86400) / 3600);
                setText("labSesExp", diffSec > 0 ? `${d}d ${h}h` : "expired");
            }
            const tok = getToken();
            setText("labSesToken", tok ? tok.slice(0, 24) + "…" : "—");

            // ---- KV state viewers ----
            const renderJsonInto = (id, data) => {
                const el = document.getElementById(id);
                if (el) el.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
            };
            const makeLoader = (endpoint, jsonId) => () => {
                renderJsonInto(jsonId, "loading…");
                fetch(endpoint)
                    .then((r) => r.json())
                    .then((d) => renderJsonInto(jsonId, d))
                    .catch((e) => renderJsonInto(jsonId, { error: e.message }));
            };
            const loadChips   = makeLoader("/api/chips",   "labChipsJson");
            const loadStats   = makeLoader("/api/stats",   "labStatsJson");
            const loadPresets = makeLoader("/api/presets", "labPresetsJson");
            const loadHistory = makeLoader("/api/history", "labHistoryJson");
            loadChips(); loadStats(); loadPresets(); loadHistory();
            document.getElementById("labReloadChips")?.addEventListener("click",   loadChips);
            document.getElementById("labReloadStats")?.addEventListener("click",   loadStats);
            document.getElementById("labReloadPresets")?.addEventListener("click", loadPresets);
            document.getElementById("labReloadHistory")?.addEventListener("click", loadHistory);

            // ---- PROVIDER_STATUS ----
            const renderProviders = (info) => {
                const el = document.getElementById("labProviders");
                if (!el) return;
                if (!info || info.error) {
                    el.innerHTML = `<div class="lab-empty">— ${info?.error || "unavailable"} —</div>`;
                    return;
                }
                const dot = (ok) => `<span class="lab-dot ${ok ? "lab-dot--ok" : "lab-dot--err"}"></span>`;
                const p = info.providers || {};
                const rt = info.runtime || {};
                el.innerHTML = `
                    <div class="lab-rows">
                        <div class="lab-row">${dot(p.kling?.configured)}<span>kling</span><span>${p.kling?.model || "—"}</span></div>
                        <div class="lab-row">${dot(p.bfl?.configured)}<span>bfl (flux)</span><span>${p.bfl?.model || "—"}</span></div>
                        <div class="lab-row">${dot(p.claude?.configured)}<span>claude</span><span>${p.claude?.model || "—"}</span></div>
                        <div class="lab-row">${dot(p.kv?.configured)}<span>kv storage</span><span>${p.kv?.naming || "—"}</span></div>
                        <div class="lab-row">${dot(p.auth?.configured)}<span>auth</span><span>user:${p.auth?.user_pw_set ? "✓" : "✗"} dev:${p.auth?.dev_pw_set ? "✓" : "✗"}</span></div>
                    </div>
                    <div class="lab-runtime">
                        <span>python ${rt.python || "?"}</span>
                        <span class="lab-runtime-sep">·</span>
                        <span>${rt.vercel_env || "?"} (${rt.vercel_region || "?"})</span>
                        <span class="lab-runtime-sep">·</span>
                        <span>v${info.version}</span>
                    </div>`;
            };
            const loadInfo = () => {
                fetch("/api/info").then((r) => r.json()).then(renderProviders).catch((e) => renderProviders({ error: e.message }));
            };
            loadInfo();
            document.getElementById("labReloadInfo")?.addEventListener("click", loadInfo);

            // ---- STORAGE_BROWSER ----
            const renderStorage = () => {
                const el = document.getElementById("labStorage");
                if (!el) return;
                try {
                    const keys = Object.keys(localStorage).sort();
                    if (!keys.length) {
                        el.innerHTML = `<div class="lab-empty">— empty —</div>`;
                        return;
                    }
                    el.innerHTML = keys.map((k) => {
                        const v = localStorage.getItem(k) || "";
                        const size = new Blob([v]).size;
                        const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
                        const preview = v.slice(0, 80).replace(/</g, "&lt;");
                        return `
                        <div class="lab-storage-row" data-key="${k}">
                            <div class="lab-storage-key">${k}</div>
                            <div class="lab-storage-size">${sizeStr}</div>
                            <div class="lab-storage-preview">${preview}${v.length > 80 ? "…" : ""}</div>
                        </div>`;
                    }).join("");
                } catch (e) {
                    el.innerHTML = `<div class="lab-empty">— ${e.message} —</div>`;
                }
            };
            renderStorage();
            document.getElementById("labReloadStorage")?.addEventListener("click", renderStorage);
            // click a row to log the full value to the console
            document.getElementById("labStorage")?.addEventListener("click", (e) => {
                const row = e.target.closest(".lab-storage-row");
                if (!row) return;
                const k = row.dataset.key;
                const v = localStorage.getItem(k);
                console.log(`[lab] localStorage[${k}] =`, v);
                row.classList.add("is-pulse");
                setTimeout(() => row.classList.remove("is-pulse"), 600);
            });

            // ---- RECENT_RENDERS ----
            const fmtDateShort = (iso) => {
                if (!iso) return "—";
                const d = new Date(iso);
                if (isNaN(+d)) return "?";
                return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            };
            const renderRecent = (data) => {
                const el = document.getElementById("labRecent");
                if (!el) return;
                const entries = (data?.history || []).slice(0, 8);
                if (!entries.length) {
                    el.innerHTML = `<div class="lab-empty">— no renders yet —</div>`;
                    return;
                }
                el.innerHTML = entries.map((e) => {
                    const isVid = e.page === "video";
                    const detail = isVid ? `${e.duration || "?"}s · ${e.quality || "std"}` : (e.aspectRatio || "?");
                    return `
                    <div class="lab-recent-row">
                        <span class="lab-recent-badge lab-recent-badge--${e.page}">${(e.page || "?").toUpperCase()}</span>
                        <span class="lab-recent-detail">${detail}</span>
                        <span class="lab-recent-model">${e.model || "?"}</span>
                        <span class="lab-recent-prompt">${(e.prompt || "").slice(0, 70).replace(/</g, "&lt;")}${(e.prompt || "").length > 70 ? "…" : ""}</span>
                        <span class="lab-recent-date">${fmtDateShort(e.createdAt)}</span>
                    </div>`;
                }).join("");
            };
            const loadRecent = () => {
                renderRecent(null);
                fetch("/api/history").then((r) => r.json()).then(renderRecent).catch(() => renderRecent(null));
            };
            loadRecent();
            document.getElementById("labReloadRecent")?.addEventListener("click", loadRecent);

            // ---- PROMPT_TESTER ----
            const testerInput  = document.getElementById("labTesterInput");
            const testerPage   = document.getElementById("labTesterPage");
            const testerRun    = document.getElementById("labTesterRun");
            const testerOut    = document.getElementById("labTesterOut");
            testerRun?.addEventListener("click", async () => {
                const prompt = (testerInput?.value || "").trim();
                if (!prompt) { testerInput?.focus(); return; }
                testerRun.disabled = true;
                testerRun.textContent = "✦ enhancing…";
                testerOut.hidden = false;
                testerOut.innerHTML = `<div class="lab-tester-loading">claude is thinking…</div>`;
                try {
                    const t0 = performance.now();
                    const r = await fetch("/api/enhance", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt, page: testerPage?.value || "video" }),
                    });
                    const ms = Math.round(performance.now() - t0);
                    const d = await r.json();
                    if (!r.ok || !d.enhanced) {
                        testerOut.innerHTML = `<div class="lab-tester-err">// ${d.error || ("status " + r.status)}</div>`;
                    } else {
                        testerOut.innerHTML = `
                            <div class="lab-tester-meta">enhanced in ${ms}ms · ${d.enhanced.length} chars</div>
                            <div class="lab-tester-result">${d.enhanced.replace(/</g, "&lt;")}</div>`;
                    }
                } catch (err) {
                    testerOut.innerHTML = `<div class="lab-tester-err">// ${err.message}</div>`;
                } finally {
                    testerRun.disabled = false;
                    testerRun.textContent = "✦ enhance";
                }
            });

            // ---- API health pings ----
            const pingRow = async (row) => {
                const url = row.dataset.endpoint;
                const method = row.dataset.method || "GET";
                const statusEl = row.querySelector(".lab-h-status");
                if (!statusEl || !url) return;
                statusEl.textContent = "pinging…";
                statusEl.className = "lab-h-status";
                const t0 = performance.now();
                try {
                    // HEAD is rejected by some endpoints (we only allow GET/POST/DELETE)
                    // so we use GET as a fallback for everything — the body is small
                    const r = await fetch(url, { method: "GET" });
                    const ms = Math.round(performance.now() - t0);
                    const cls = r.status < 300 ? "ok" : r.status < 500 ? "warn" : "err";
                    statusEl.textContent = `${r.status} · ${ms}ms`;
                    statusEl.className = `lab-h-status lab-h-status--${cls}`;
                } catch (e) {
                    statusEl.textContent = "unreachable";
                    statusEl.className = "lab-h-status lab-h-status--err";
                }
            };
            document.querySelectorAll(".lab-health-row").forEach((row) => {
                row.addEventListener("click", () => pingRow(row));
            });
            document.getElementById("labPingAll")?.addEventListener("click", () => {
                document.querySelectorAll(".lab-health-row").forEach(pingRow);
            });

            // ---- actions ----
            const showActionResult = (msg, kind = "ok") => {
                const el = document.getElementById("labActionResult");
                if (!el) return;
                el.textContent = msg;
                el.className = `lab-action-result lab-action-result--${kind}`;
                el.hidden = false;
                setTimeout(() => { el.hidden = true; }, 4000);
            };
            document.getElementById("labResetChips")?.addEventListener("click", async () => {
                if (!confirm("Reset all chip categories to defaults? Your custom chips will be lost.")) return;
                try {
                    const r = await fetch("/api/chips", { method: "DELETE" });
                    if (r.ok) { showActionResult("// chips reset", "ok"); loadChips(); }
                    else      { showActionResult(`// failed: ${r.status}`, "err"); }
                } catch (e) { showActionResult(`// error: ${e.message}`, "err"); }
            });
            document.getElementById("labClearHistory")?.addEventListener("click", async () => {
                if (!confirm("Wipe the entire render history? This cannot be undone.")) return;
                try {
                    const r = await fetch("/api/history?all=1", { method: "DELETE" });
                    if (r.ok) { showActionResult("// history wiped", "ok"); loadHistory(); loadRecent(); }
                    else      { showActionResult(`// failed: ${r.status}`, "err"); }
                } catch (e) { showActionResult(`// error: ${e.message}`, "err"); }
            });
            document.getElementById("labClearLocal")?.addEventListener("click", () => {
                if (!confirm("Clear localStorage? You'll be logged out and lose all client-side state.")) return;
                try { localStorage.clear(); } catch (e) {}
                showActionResult("// localStorage cleared · reloading", "ok");
                setTimeout(() => location.replace("/login"), 800);
            });
            document.getElementById("labForceLogout")?.addEventListener("click", () => {
                clearToken();
                location.replace("/login");
            });
        }
    }

    /* ---------- URL-PARAM PROMPT PREFILL ----------
       /image or /video can accept ?prompt=<encoded> to pre-fill the readout
       (used by the History page's "re-render" button).                     */
    if ((PAGE === "image" || PAGE === "video") && readout) {
        const urlPrompt = new URLSearchParams(location.search).get("prompt");
        if (urlPrompt) {
            readout.textContent = urlPrompt;
            userEditedPrompt = true;
            syncReadoutChrome();
        }
    }

    /* ---------- HISTORY PAGE ----------
       grid of past renders. click any card → viewer modal with re-render. */
    if (PAGE === "history") {
        const grid       = document.getElementById("historyGrid");
        const countEl    = document.getElementById("historyCount");
        const clearAllBt = document.getElementById("historyClearAll");
        const viewer     = document.getElementById("histViewer");
        const vMedia     = document.getElementById("histViewerMedia");
        const vMeta      = document.getElementById("histViewerMeta");
        const vPrompt    = document.getElementById("histViewerPrompt");
        const vDownload  = document.getElementById("histViewerDownload");
        const vRerender  = document.getElementById("histViewerRerender");
        const vDelete    = document.getElementById("histViewerDelete");

        let allEntries  = [];
        let currentFilter = "all";
        let currentEntry  = null;

        const escAttr = (s) => String(s || "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

        const fmtDate = (iso) => {
            if (!iso) return "—";
            const d = new Date(iso);
            if (isNaN(+d)) return iso.slice(0, 10);
            const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
            return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
        };

        const renderGrid = () => {
            const filtered = currentFilter === "all"
                ? allEntries
                : allEntries.filter((e) => e.page === currentFilter);

            if (countEl) countEl.textContent = `${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`;

            if (!filtered.length) {
                grid.innerHTML = `<div class="history-empty">— no renders yet · go make something —</div>`;
                return;
            }

            grid.innerHTML = filtered.map((e) => {
                const isVideo = e.page === "video";
                const media = isVideo
                    ? `<video src="${escAttr(e.mediaUrl)}" muted loop playsinline preload="metadata"></video>`
                    : `<img src="${escAttr(e.mediaUrl)}" alt="" loading="lazy"/>`;
                const badge = isVideo
                    ? `<span class="hist-card-badge hist-card-badge--video">VIDEO · ${escAttr(e.quality || "std")}</span>`
                    : `<span class="hist-card-badge hist-card-badge--image">IMAGE · ${escAttr(e.aspectRatio || "1:1")}</span>`;
                return `
                <div class="hist-card" data-id="${escAttr(e.id)}">
                    <div class="hist-card-media">${media}${badge}</div>
                    <div class="hist-card-body">
                        <div class="hist-card-prompt">${escAttr((e.prompt || "").slice(0, 140))}${(e.prompt || "").length > 140 ? "…" : ""}</div>
                        <div class="hist-card-date">${fmtDate(e.createdAt)}</div>
                    </div>
                </div>`;
            }).join("");

            // hover-to-play for video thumbnails
            grid.querySelectorAll(".hist-card video").forEach((v) => {
                v.addEventListener("mouseenter", () => v.play().catch(() => {}));
                v.addEventListener("mouseleave", () => { v.pause(); v.currentTime = 0; });
            });
        };

        const openViewer = (entry) => {
            currentEntry = entry;
            const isVideo = entry.page === "video";
            vMedia.innerHTML = isVideo
                ? `<video src="${escAttr(entry.mediaUrl)}" controls autoplay loop playsinline></video>`
                : `<img src="${escAttr(entry.mediaUrl)}" alt=""/>`;
            const metaParts = [
                entry.page?.toUpperCase(),
                entry.model || "",
                isVideo ? `${entry.duration || "?"}s · ${entry.quality || "std"}` : (entry.aspectRatio || "?"),
                fmtDate(entry.createdAt),
            ].filter(Boolean);
            vMeta.innerHTML = metaParts.map((p) => `<span>${escAttr(p)}</span>`).join("<span class='hist-meta-sep'>·</span>");
            vPrompt.textContent = entry.prompt || "(no prompt)";
            vDownload.href = entry.mediaUrl || "#";
            vDownload.download = `xperiment_${entry.id}.${isVideo ? "mp4" : "png"}`;
            viewer.hidden = false;
        };

        const closeViewer = () => {
            viewer.hidden = true;
            vMedia.innerHTML = "";  // stop any video playback
            currentEntry = null;
        };

        viewer?.addEventListener("click", (e) => {
            if (e.target.closest("[data-close-hist]")) closeViewer();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && viewer && !viewer.hidden) closeViewer();
        });

        vRerender?.addEventListener("click", () => {
            if (!currentEntry) return;
            const dest = currentEntry.page === "image" ? "/image" : "/video";
            location.href = `${dest}?prompt=${encodeURIComponent(currentEntry.prompt || "")}`;
        });

        vDelete?.addEventListener("click", async () => {
            if (!currentEntry) return;
            if (!confirm("Delete this entry from history?")) return;
            try {
                const r = await fetch(`/api/history?id=${encodeURIComponent(currentEntry.id)}`, { method: "DELETE" });
                const d = await r.json();
                allEntries = d.history || [];
                closeViewer();
                renderGrid();
            } catch (err) { alert("Delete failed: " + err.message); }
        });

        grid?.addEventListener("click", (e) => {
            const card = e.target.closest(".hist-card");
            if (!card) return;
            const entry = allEntries.find((x) => x.id === card.dataset.id);
            if (entry) openViewer(entry);
        });

        // filter buttons
        document.querySelectorAll(".history-filter").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".history-filter").forEach((b) => b.classList.remove("is-active"));
                btn.classList.add("is-active");
                currentFilter = btn.dataset.filter;
                renderGrid();
            });
        });

        clearAllBt?.addEventListener("click", async () => {
            if (!confirm("Wipe the entire render history? This cannot be undone.")) return;
            try {
                const r = await fetch("/api/history?all=1", { method: "DELETE" });
                if (r.ok) { allEntries = []; renderGrid(); }
            } catch (err) { alert("Clear failed: " + err.message); }
        });

        // initial load
        fetch("/api/history")
            .then((r) => r.json())
            .then((d) => {
                allEntries = d.history || [];
                renderGrid();
            })
            .catch(() => {
                if (grid) grid.innerHTML = `<div class="history-empty">— could not load history —</div>`;
            });
    }

    /* ---------- EASTER EGG: RS ⨯ MD ----------
       type "rsmd" anywhere on the site (not in input fields) → celebratory
       overlay with both flags. dev-only — operator login never sees this. */
    const rsmdEgg = document.getElementById("rsmdEgg");
    if (rsmdEgg && isDev()) {
        const inputField = (el) => {
            if (!el) return false;
            const tag = (el.tagName || "").toLowerCase();
            return tag === "input" || tag === "textarea" || el.isContentEditable;
        };

        const TRIGGER = "rsmd";
        let typedBuffer = "";
        let dismissTimer = null;

        const fireEgg = () => {
            rsmdEgg.hidden = false;
            // restart animation if already visible
            rsmdEgg.classList.remove("is-active");
            void rsmdEgg.offsetWidth;
            rsmdEgg.classList.add("is-active");
            // bonus sparkle burst near center if the sparkle system is up
            window.dispatchEvent(new CustomEvent("xa-burst", {
                detail: { x: window.innerWidth / 2, y: window.innerHeight / 2, count: 36 }
            }));
            if (dismissTimer) clearTimeout(dismissTimer);
            dismissTimer = setTimeout(() => {
                rsmdEgg.classList.remove("is-active");
                setTimeout(() => { rsmdEgg.hidden = true; }, 600);
            }, 4200);
        };

        document.addEventListener("keydown", (e) => {
            if (inputField(e.target)) return;
            if (e.key.length !== 1) return;
            typedBuffer = (typedBuffer + e.key.toLowerCase()).slice(-TRIGGER.length);
            if (typedBuffer === TRIGGER) {
                typedBuffer = "";
                fireEgg();
            }
        });

        rsmdEgg.addEventListener("click", () => {
            rsmdEgg.classList.remove("is-active");
            setTimeout(() => { rsmdEgg.hidden = true; }, 300);
        });
    }
})();
