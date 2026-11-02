/* Main page: weather-aware pools, widget cycling, shuffle, and likes. */
(function () {
  "use strict";

  const TYPES = ["top", "bottom", "shoes"];
  const PLURAL = { top: "tops", bottom: "bottoms", shoes: "shoes" };
  const LABEL = { top: "top", bottom: "bottom", shoes: "shoes" };

  const state = {
    weather: null,
    weatherKind: null,
    manual: false,
    pools: { top: [], bottom: [], shoes: [] },
    index: { top: 0, bottom: 0, shoes: 0 },
    current: { top: null, bottom: null, shoes: null },
    fallbackTypes: [],
    saved: new Set(),
    liked: false,
    busy: false,
    initialised: false,
  };

  let els = {};
  let shuffleTimer = null;
  let lastWeatherLoad = Date.now();

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function widgetFor(type) {
    return $('.widget[data-type="' + type + '"]');
  }

  function comboKey(top, bottom, shoes) {
    if (!top || !bottom || !shoes) return null;
    return top.id + "-" + bottom.id + "-" + shoes.id;
  }

  function currentKey() {
    return comboKey(state.current.top, state.current.bottom, state.current.shoes);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* ------------------------------------------------------------- rendering */
  function renderWidget(type) {
    const widget = widgetFor(type);
    if (!widget) return;
    const item = state.current[type];
    const pool = state.pools[type] || [];
    const img = $(".widget-img", widget);
    const empty = $(".widget-empty", widget);
    const emptyText = $(".empty-text", widget);
    const emptyLink = $(".empty-link", widget);
    const desc = $(".widget-desc", widget);
    const weatherEl = $(".widget-weather", widget);
    const dot = $(".mismatch-dot", widget);
    const arrows = widget.querySelectorAll(".arrow");

    widget.classList.toggle("is-empty", !item);

    if (item) {
      empty.hidden = true;
      img.hidden = false;
      UI.crossfade(img, UI.itemImage(item));
      img.alt = item.description || "Wardrobe " + LABEL[type];
      desc.textContent = item.description || "Untitled " + LABEL[type];
      const mismatch = Boolean(
        state.weatherKind &&
          item.weather !== "both" &&
          item.weather !== state.weatherKind
      );
      weatherEl.textContent =
        item.weather === "both" ? "hot or cold" : item.weather;
      weatherEl.classList.toggle("is-mismatch", mismatch);
      dot.hidden = !mismatch;
      dot.title = mismatch
        ? "This " +
          LABEL[type] +
          " is tagged " +
          item.weather +
          ", but today is " +
          state.weatherKind +
          "."
        : "";
    } else {
      empty.hidden = false;
      img.removeAttribute("src");
      img.alt = "";
      desc.textContent = "\u2014";
      weatherEl.textContent = "";
      weatherEl.classList.remove("is-mismatch");
      dot.hidden = true;
      emptyText.textContent =
        "No " + PLURAL[type] + " yet \u2014 add one to your wardrobe.";
      emptyLink.hidden = false;
      emptyLink.textContent =
        type === "shoes" ? "Add shoes" : "Add a " + LABEL[type];
    }

    const disabled = pool.length <= 1;
    arrows.forEach(function (arrow) {
      arrow.setAttribute("aria-disabled", disabled ? "true" : "false");
      arrow.disabled = disabled;
    });
  }

  function renderAll() {
    TYPES.forEach(renderWidget);
    renderFallbackNote();
    updateLike();
  }

  function renderFallbackNote() {
    const note = els.fallbackNote;
    if (!note) return;
    if (!state.fallbackTypes.length) {
      note.hidden = true;
      note.innerHTML = "";
      return;
    }
    const names = state.fallbackTypes.map(function (type) {
      return PLURAL[type];
    });
    const list = names.join(" and ");
    note.hidden = false;
    note.innerHTML =
      "<strong>Off-forecast pieces:</strong> no " +
      UI.escapeHtml(state.weatherKind || "") +
      "-weather " +
      UI.escapeHtml(list) +
      ', so those slots show anything in your wardrobe. <a class="empty-link" href="/wardrobe">Add weather-ready pieces</a>.';
  }

  function updateLike() {
    if (!els.like) return;
    const key = currentKey();
    state.liked = Boolean(key && state.saved.has(key));
    els.like.setAttribute("aria-pressed", state.liked ? "true" : "false");
    els.like.setAttribute(
      "aria-label",
      state.liked ? "This look is saved" : "Like this look"
    );
    els.like.disabled = !key || state.busy;
    const label = $(".like-label", els.like);
    if (label) label.textContent = state.liked ? "Saved" : "Like this look";
  }

  function setBusy(busy) {
    state.busy = busy;
    if (els.generate) {
      els.generate.disabled = busy;
      els.generate.classList.toggle("is-busy", busy);
    }
    updateLike();
  }

  /* ---------------------------------------------------------------- weather */
  function renderRailWeather(data) {
    const body = document.getElementById("rail-weather-body");
    if (!body) return;
    if (!data || !data.weather) {
      body.innerHTML =
        '<div class="rail-weather-main"><span class="rail-temp">\u2014</span>' +
        '<span class="rail-conditions">Weather unavailable</span></div>' +
        '<div class="rail-weather-meta">Pick a forecast above to keep styling offline.</div>';
      return;
    }
    const temp = UI.temperatureOf(data);
    const feels =
      data.apparent !== null && data.apparent !== undefined
        ? Math.round(data.apparent)
        : temp;
    const stale = data.stale ? " \u00b7 stale" : "";
    body.innerHTML =
      '<div class="rail-weather-main"><span class="rail-temp">' +
      (temp === null ? "\u2014" : temp + "\u00b0") +
      '</span><span class="rail-conditions">' +
      UI.escapeHtml(data.label || "") +
      "</span></div>" +
      '<div class="rail-weather-meta"><strong>' +
      UI.escapeHtml(data.weather) +
      "</strong> weather \u00b7 feels like " +
      (feels === null ? "\u2014" : feels + "\u00b0") +
      "</div>" +
      '<div class="rail-weather-foot">Updated ' +
      UI.escapeHtml(UI.timeAgo(data.fetchedAt)) +
      " \u00b7 " +
      UI.escapeHtml(UI.sourceLabel(data.source)) +
      stale +
      "</div>";
  }

  function showBanner(show) {
    if (!els.banner) return;
    els.banner.hidden = !show;
    const text = $(".banner-text", els.banner);
    if (show && state.manual) {
      text.textContent =
        "Live weather is unavailable. Showing " +
        state.weatherKind +
        " pieces manually:";
    } else if (show) {
      text.textContent =
        "Live weather is unavailable. Pick a forecast so Fitcheck can style your wardrobe:";
    }
    els.banner
      .querySelectorAll("[data-weather]")
      .forEach(function (button) {
        button.classList.toggle(
          "is-active",
          state.manual && button.dataset.weather === state.weatherKind
        );
      });
  }

  async function loadPools(kind) {
    let results;
    try {
      results = await Promise.all(
        TYPES.map(async function (type) {
          let items = await API.get(
            "/api/items?type=" + type + "&weather=" + encodeURIComponent(kind)
          );
          let fallback = false;
          if (!items.length) {
            items = await API.get("/api/items?type=" + type);
            fallback = items.length > 0;
          }
          return { type: type, items: items, fallback: fallback };
        })
      );
    } catch (err) {
      UI.toast(err.message, "error");
      return;
    }

    state.fallbackTypes = [];
    results.forEach(function (result) {
      const previous = state.current[result.type];
      let nextIndex = previous
        ? result.items.findIndex(function (item) {
            return item.id === previous.id;
          })
        : -1;
      if (nextIndex < 0) {
        nextIndex = result.items.length
          ? Math.floor(Math.random() * result.items.length)
          : 0;
      }
      state.pools[result.type] = result.items;
      state.index[result.type] = nextIndex;
      state.current[result.type] = result.items[nextIndex] || null;
      if (result.fallback) state.fallbackTypes.push(result.type);
    });
  }

  async function applyWeather(data) {
    state.weather = data || null;
    if (data && data.weather) {
      state.weatherKind = data.weather;
      state.manual = false;
      showBanner(false);
    } else if (!state.weatherKind) {
      state.weatherKind = "cold";
      showBanner(true);
    }
    renderRailWeather(data);
    await loadPools(state.weatherKind);
    renderAll();
  }

  async function onWeatherUpdate(data) {
    lastWeatherLoad = Date.now();
    if (!state.initialised) return;
    if (!data || !data.weather) {
      if (!state.manual) showBanner(true);
      renderRailWeather(null);
      return;
    }
    state.weather = data;
    if (state.manual || data.weather !== state.weatherKind) {
      await applyWeather(data);
    } else {
      renderRailWeather(data);
    }
  }

  /* ------------------------------------------------------------- interactions */
  function shift(type, direction) {
    if (state.busy) return;
    const pool = state.pools[type] || [];
    if (pool.length <= 1) return;
    state.index[type] =
      (state.index[type] + direction + pool.length) % pool.length;
    state.current[type] = pool[state.index[type]];
    renderWidget(type);
    updateLike();
  }

  function startShuffle() {
    stopShuffle();
    TYPES.forEach(function (type) {
      const widget = widgetFor(type);
      if (widget) widget.classList.add("is-shuffling");
    });
    shuffleTimer = setInterval(function () {
      TYPES.forEach(function (type) {
        const pool = state.pools[type] || [];
        if (!pool.length) return;
        const widget = widgetFor(type);
        const img = widget ? $(".widget-img", widget) : null;
        if (!img) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        img.src = UI.itemImage(pick);
      });
    }, 70);
  }

  function stopShuffle() {
    if (shuffleTimer) {
      clearInterval(shuffleTimer);
      shuffleTimer = null;
    }
    TYPES.forEach(function (type) {
      const widget = widgetFor(type);
      if (widget) widget.classList.remove("is-shuffling");
    });
  }

  async function generateLook() {
    if (state.busy) return;
    setBusy(true);
    startShuffle();
    const started = performance.now();

    let result;
    try {
      const exclude = {};
      TYPES.forEach(function (type) {
        if (state.current[type]) exclude[type] = state.current[type].id;
      });
      result = await API.post("/api/generate", {
        weather: state.weatherKind,
        exclude: exclude,
      });
    } catch (err) {
      stopShuffle();
      setBusy(false);
      renderAll();
      UI.toast(err.message, "error");
      return;
    }

    await delay(Math.max(0, 480 - (performance.now() - started)));
    stopShuffle();

    TYPES.forEach(function (type) {
      const item = result[type] || null;
      state.current[type] = item;
      if (!item) return;
      let index = (state.pools[type] || []).findIndex(function (candidate) {
        return candidate.id === item.id;
      });
      if (index < 0) {
        state.pools[type] = (state.pools[type] || []).concat([item]);
        index = state.pools[type].length - 1;
      }
      state.index[type] = index;
    });

    if (result.weather) state.weatherKind = result.weather;
    state.fallbackTypes = result.fallbackTypes || [];
    renderAll();
    setBusy(false);

    const missing = TYPES.filter(function (type) {
      return !state.current[type];
    });
    if (missing.length) {
      UI.toast(
        "Add " +
          missing
            .map(function (type) {
              return type === "shoes" ? "shoes" : "a " + LABEL[type];
            })
            .join(", ") +
          " to complete a look.",
        "info"
      );
    }
  }

  async function likeLook() {
    if (state.busy) return;
    const key = currentKey();
    if (!key) {
      UI.toast("Generate a complete look first.", "info");
      return;
    }
    if (state.liked) {
      UI.toast("This look is already saved.", "info");
      return;
    }

    setBusy(true);
    try {
      const outfit = await API.post("/api/outfits", {
        topId: state.current.top.id,
        bottomId: state.current.bottom.id,
        shoesId: state.current.shoes.id,
        weather: state.weatherKind,
      });
      const savedKey = comboKey(outfit.top, outfit.bottom, outfit.shoes) || key;
      state.saved.add(savedKey);
      els.like.classList.add("is-pop");
      setTimeout(function () {
        els.like.classList.remove("is-pop");
      }, 430);
      UI.toast("Look saved to Outfits", "success");
    } catch (err) {
      UI.toast(err.message, "error");
    } finally {
      setBusy(false);
      updateLike();
    }
  }

  async function loadSaved() {
    try {
      const outfits = await API.get("/api/outfits");
      state.saved = new Set(
        outfits
          .map(function (outfit) {
            return comboKey(outfit.top, outfit.bottom, outfit.shoes);
          })
          .filter(Boolean)
      );
    } catch (err) {
      state.saved = new Set();
    }
  }

  /* ------------------------------------------------------------------- wiring */
  function wire() {
    els = {
      generate: document.getElementById("generate"),
      like: document.getElementById("like"),
      fallbackNote: document.getElementById("fallback-note"),
      banner: document.getElementById("weather-banner"),
    };

    if (els.generate) els.generate.addEventListener("click", generateLook);
    if (els.like) els.like.addEventListener("click", likeLook);

    document.querySelectorAll(".widget").forEach(function (widget) {
      const type = widget.dataset.type;
      widget.querySelectorAll(".arrow").forEach(function (arrow) {
        arrow.addEventListener("click", function () {
          shift(type, Number(arrow.dataset.dir));
        });
      });
    });

    if (els.banner) {
      els.banner
        .querySelectorAll("[data-weather]")
        .forEach(function (button) {
          button.addEventListener("click", async function () {
            state.manual = true;
            state.weatherKind = button.dataset.weather;
            showBanner(true);
            await loadPools(state.weatherKind);
            renderAll();
          });
        });
    }

    const refresh = document.getElementById("refresh-weather");
    if (refresh) {
      refresh.addEventListener("click", async function () {
        refresh.disabled = true;
        refresh.classList.add("is-spinning");
        await UI.refreshWeather();
        setTimeout(function () {
          refresh.disabled = false;
          refresh.classList.remove("is-spinning");
        }, 450);
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastWeatherLoad > 5 * 60 * 1000
      ) {
        lastWeatherLoad = Date.now();
        UI.refreshWeather();
      }
    });
  }

  async function init() {
    wire();
    setBusy(true);

    let weather = null;
    try {
      weather = await UI.initWeatherChip({ onData: onWeatherUpdate });
    } catch (err) {
      weather = null;
    }
    state.initialised = true;
    lastWeatherLoad = Date.now();

    state.weather = weather;
    state.weatherKind = weather && weather.weather ? weather.weather : "cold";
    state.manual = false;
    if (!weather || !weather.weather) showBanner(true);
    renderRailWeather(weather);

    await Promise.all([loadPools(state.weatherKind), loadSaved()]);
    renderAll();
    setBusy(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
