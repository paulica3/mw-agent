/* =============================================================
   XPERIMENT_AI / client fx + interactions
   ============================================================= */

(() => {
    "use strict";

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
            const next = root.getAttribute("data-theme") === "bloom" ? "chaos" : "bloom";
            applyTheme(next, true);
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
       chips for theme/mood/camera/motion are user-customizable via Dashboard
       and persisted to localStorage. color/duration stay hardcoded in HTML
       because they have special styling (swatches, numeric formatting).      */
    const CHIP_STORE_KEY = "xa-chips";

    const DEFAULT_CHIPS = {
        theme: [
            { value: "futuristic", label: "FUTURISTIC", fragment: "cinematic futuristic aesthetic, holographic overlays, neon-lit" },
            { value: "surreal",    label: "SURREAL",    fragment: "dreamlike surreal imagery, impossible geometry" },
            { value: "gritty",     label: "GRITTY",     fragment: "raw gritty urban texture, harsh contrast" },
            { value: "dreamlike",  label: "DREAMLIKE",  fragment: "soft pastel dreamscape, hazy diffusion" },
            { value: "retro",      label: "RETRO",      fragment: "vintage analog film grain, warm faded tones" },
            { value: "classic",    label: "CLASSIC",    fragment: "timeless cinematic composition, rich shadows" },
        ],
        mood: [
            { value: "dark",         label: "DARK_&_TENSE", fragment: "dark & tense atmosphere" },
            { value: "euphoric",     label: "EUPHORIC",     fragment: "euphoric high-energy mood" },
            { value: "melancholic",  label: "MELANCHOLIC",  fragment: "melancholic introspective tone" },
            { value: "chaotic",      label: "CHAOTIC",      fragment: "chaotic frantic energy" },
        ],
        camera: [
            { value: "wide",        label: "WIDE_CINEMATIC", fragment: "wide cinematic shot" },
            { value: "close",       label: "CLOSE_UP_RAW",   fragment: "intimate close-up, shallow depth" },
            { value: "drone",       label: "DRONE",          fragment: "aerial drone perspective" },
            { value: "slow_motion", label: "SLOW_MOTION",    fragment: "ultra slow motion" },
        ],
        motion: [
            { value: "static",   label: "STATIC_HOLD",   fragment: "static locked frame" },
            { value: "slow_pan", label: "SLOW_PAN",      fragment: "slow lateral pan" },
            { value: "dolly",    label: "DOLLY_PUSH",    fragment: "dolly push toward subject" },
            { value: "orbit",    label: "ORBIT",         fragment: "orbiting camera" },
            { value: "handheld", label: "HANDHELD",      fragment: "handheld shaky cam" },
            { value: "warp",     label: "REALITY_WARP",  fragment: "reality-warping camera motion" },
        ],
    };

    // legacy fragments for non-customizable groups (color, duration)
    const STATIC_FRAGMENTS = {
        color: {
            cold_blue:     "cold blue color grade",
            warm_golden:   "warm golden hour grade",
            desaturated:   "desaturated near-monochrome",
            high_contrast: "high contrast punchy grade",
        },
        duration: {
            "2":  "2s clip",
            "4":  "4s clip",
            "8":  "8s clip",
            "12": "12s clip",
        },
    };

    const loadChips = () => {
        try {
            const raw = localStorage.getItem(CHIP_STORE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // merge: any group not in user data falls back to defaults
                return { ...DEFAULT_CHIPS, ...parsed };
            }
        } catch (e) {}
        return JSON.parse(JSON.stringify(DEFAULT_CHIPS));  // deep clone
    };

    const saveChips = (chips) => {
        try { localStorage.setItem(CHIP_STORE_KEY, JSON.stringify(chips)); }
        catch (e) {}
    };

    const getFragment = (group, val) => {
        if (STATIC_FRAGMENTS[group]) return STATIC_FRAGMENTS[group][val];
        const chips = loadChips();
        return chips[group]?.find((c) => c.value === val)?.fragment;
    };

    /* ---------- RENDER DYNAMIC CHIPS ---------- */
    const renderDynamicGrids = () => {
        const chips = loadChips();
        document.querySelectorAll('.chip-grid[data-dynamic="true"]').forEach((grid) => {
            const group = grid.dataset.group;
            const items = chips[group] || [];
            grid.innerHTML = items.map((c) =>
                `<button class="chip" data-value="${c.value}">${c.label}</button>`
            ).join("");
        });
    };
    renderDynamicGrids();

    /* ---------- CHIP SELECTION + PROMPT READOUT ---------- */
    const selections = {};
    const readout    = document.getElementById("promptReadout");
    const director   = document.querySelector(".director");

    const renderReadout = () => {
        if (!readout) return;
        const parts = [];
        for (const group of Object.keys(selections)) {
            const frag = getFragment(group, selections[group]);
            if (frag) parts.push(frag);
        }
        const note = director?.value?.trim();
        if (note) parts.push(note);
        readout.textContent = parts.length ? parts.join(", ") : "— awaiting input —";
    };

    // event delegation: works for both static and dynamically-rendered chips
    document.querySelectorAll(".chip-grid").forEach((grid) => {
        const group = grid.dataset.group;
        if (!group) return;
        grid.addEventListener("click", (e) => {
            const chip = e.target.closest(".chip");
            if (!chip || !grid.contains(chip)) return;
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
    });

    if (director) director.addEventListener("input", renderReadout);

    /* ---------- DASHBOARD ---------- */
    const dashboardEl = document.querySelector(".dashboard");
    if (dashboardEl) {
        const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

        const renderDashboardGroup = (group) => {
            const panel = dashboardEl.querySelector(`.dash-panel[data-group="${group}"]`);
            if (!panel) return;
            const list = panel.querySelector(".dash-chips");
            const chips = loadChips();
            const items = chips[group] || [];
            list.innerHTML = items.map((c) => `
                <div class="dash-chip" data-value="${c.value}">
                    <div class="dash-chip-head">
                        <span class="dash-chip-label">${c.label}</span>
                        <button class="dash-chip-remove" type="button" aria-label="Remove ${c.label}">×</button>
                    </div>
                    <div class="dash-chip-frag">${c.fragment}</div>
                </div>
            `).join("") || `<div class="dash-empty">— no chips. add one below. —</div>`;
        };

        const renderAll = () => {
            ["theme", "mood", "camera", "motion"].forEach(renderDashboardGroup);
        };
        renderAll();

        // delegated handlers: remove chip
        dashboardEl.addEventListener("click", (e) => {
            const removeBtn = e.target.closest(".dash-chip-remove");
            if (removeBtn) {
                const chipEl = removeBtn.closest(".dash-chip");
                const panel  = removeBtn.closest(".dash-panel");
                if (!chipEl || !panel) return;
                const group  = panel.dataset.group;
                const value  = chipEl.dataset.value;
                const chips  = loadChips();
                chips[group] = (chips[group] || []).filter((c) => c.value !== value);
                saveChips(chips);
                renderDashboardGroup(group);
                return;
            }

            const resetBtn = e.target.closest(".dash-reset");
            if (resetBtn) {
                const panel = resetBtn.closest(".dash-panel");
                const group = panel.dataset.group;
                const chips = loadChips();
                chips[group] = JSON.parse(JSON.stringify(DEFAULT_CHIPS[group] || []));
                saveChips(chips);
                renderDashboardGroup(group);
            }
        });

        // delegated form submissions: add chip
        dashboardEl.addEventListener("submit", (e) => {
            const form = e.target.closest(".dash-add");
            if (!form) return;
            e.preventDefault();
            const panel = form.closest(".dash-panel");
            const group = panel.dataset.group;
            const labelInput = form.querySelector('[name="label"]');
            const fragInput  = form.querySelector('[name="fragment"]');
            const rawLabel = labelInput.value.trim();
            const rawFrag  = fragInput.value.trim();
            if (!rawLabel || !rawFrag) return;
            const value = slugify(rawLabel);
            if (!value) return;
            const chips = loadChips();
            chips[group] = chips[group] || [];
            if (chips[group].some((c) => c.value === value)) {
                // already exists — flash the existing one
                const existing = panel.querySelector(`.dash-chip[data-value="${value}"]`);
                if (existing) {
                    existing.classList.add("dash-chip--flash");
                    setTimeout(() => existing.classList.remove("dash-chip--flash"), 800);
                }
                return;
            }
            chips[group].push({ value, label: rawLabel.toUpperCase(), fragment: rawFrag });
            saveChips(chips);
            renderDashboardGroup(group);
            labelInput.value = "";
            fragInput.value  = "";
            labelInput.focus();
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

    /* ---------- GENERATE BUTTON ---------- */
    const genBtn = document.getElementById("generateBtn");
    if (genBtn) {
        genBtn.addEventListener("click", () => {
            const label = genBtn.querySelector(".gen-label");
            if (!label) return;
            const original = label.textContent;
            const chars = "▓▒░█▌▐■□◆◇";
            let i = 0;
            const id = setInterval(() => {
                label.textContent = Array.from({ length: original.length }, () =>
                    chars[Math.floor(Math.random() * chars.length)]
                ).join("");
                if (++i > 14) {
                    clearInterval(id);
                    label.textContent = "SIGNAL_SENT";
                    setTimeout(() => { label.textContent = original; }, 1400);
                }
            }, 55);
        });
    }
})();
