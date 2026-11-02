/* Shared UI helpers: toasts, modals, weather chip, formatting, image fades. */
(function () {
  "use strict";

  const WMO_EMOJI = {
    0: "\u2600\ufe0f",
    1: "\ud83c\udf24\ufe0f",
    2: "\u26c5",
    3: "\u2601\ufe0f",
    45: "\ud83c\udf2b\ufe0f",
    48: "\ud83c\udf2b\ufe0f",
    51: "\ud83c\udf26\ufe0f",
    53: "\ud83c\udf26\ufe0f",
    55: "\ud83c\udf26\ufe0f",
    56: "\ud83c\udf27\ufe0f",
    57: "\ud83c\udf27\ufe0f",
    61: "\ud83c\udf27\ufe0f",
    63: "\ud83c\udf27\ufe0f",
    65: "\ud83c\udf27\ufe0f",
    66: "\ud83c\udf27\ufe0f",
    67: "\ud83c\udf27\ufe0f",
    71: "\u2744\ufe0f",
    73: "\u2744\ufe0f",
    75: "\u2744\ufe0f",
    77: "\u2744\ufe0f",
    80: "\ud83c\udf26\ufe0f",
    81: "\ud83c\udf27\ufe0f",
    82: "\u26c8\ufe0f",
    85: "\ud83c\udf28\ufe0f",
    86: "\ud83c\udf28\ufe0f",
    95: "\u26c8\ufe0f",
    96: "\u26c8\ufe0f",
    99: "\u26c8\ufe0f",
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function imgUrl(path) {
    if (!path) return "";
    return (
      "/uploads/" +
      String(path)
        .replace(/^\/+/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function itemImage(item) {
    if (!item) return "";
    return imgUrl(item.thumbPath || item.path);
  }

  function parseDbDate(value) {
    if (!value) return new Date(NaN);
    const match = String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
    );
    if (match) {
      return new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6])
        )
      );
    }
    return new Date(value);
  }

  function timeAgo(value) {
    const date = parseDbDate(value);
    if (isNaN(date.getTime())) return "";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 45) return "just now";
    if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.round(seconds / 3600) + " hr ago";
    return Math.round(seconds / 86400) + " days ago";
  }

  function formatDate(value) {
    const date = parseDbDate(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function dayKey(value) {
    const date = parseDbDate(value);
    if (isNaN(date.getTime())) return "unknown";
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function relativeDayLabel(key) {
    const today = new Date();
    const todayKey =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");
    const yesterday = new Date(today.getTime() - 86400000);
    const yesterdayKey =
      yesterday.getFullYear() +
      "-" +
      String(yesterday.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(yesterday.getDate()).padStart(2, "0");
    if (key === todayKey) return "Today";
    if (key === yesterdayKey) return "Yesterday";
    const parts = key.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(date.getTime())) return key;
    const options = { day: "numeric", month: "short" };
    if (date.getFullYear() !== today.getFullYear()) options.year = "numeric";
    return date.toLocaleDateString(undefined, options);
  }

  function weatherEmoji(code) {
    if (code === null || code === undefined) return "\ud83c\udf21\ufe0f";
    return WMO_EMOJI[Number(code)] || "\ud83c\udf21\ufe0f";
  }

  function temperatureOf(data) {
    if (!data) return null;
    const value =
      data.apparent !== null && data.apparent !== undefined
        ? data.apparent
        : data.temperature;
    return value === null || value === undefined ? null : Math.round(value);
  }

  function sourceLabel(source) {
    return (
      {
        geo: "your location",
        ip: "approximate location",
        default: "default location",
        cache: "cached reading",
        error: "unavailable",
      }[source] || source || "unknown"
    );
  }

  /* ---------------------------------------------------------------- toasts */
  let toastStack = null;

  function ensureToastStack() {
    if (toastStack) return toastStack;
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
    return toastStack;
  }

  function toast(message, kind, duration) {
    const stack = ensureToastStack();
    while (stack.children.length >= 4) stack.removeChild(stack.firstChild);

    const node = document.createElement("div");
    node.className = "toast toast-" + (kind || "info");
    node.setAttribute("role", "status");
    const icon = kind === "error" ? "!" : kind === "success" ? "\u2713" : "i";
    node.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' +
      icon +
      "</span><span>" +
      escapeHtml(message) +
      "</span>";
    stack.appendChild(node);
    requestAnimationFrame(function () {
      node.classList.add("is-visible");
    });
    setTimeout(function () {
      node.classList.remove("is-visible");
      setTimeout(function () {
        node.remove();
      }, 260);
    }, duration || 3600);
  }

  /* ---------------------------------------------------------------- modals */
  let modalRoot = null;
  let modalOnClose = null;

  function ensureModal() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement("div");
    modalRoot.className = "modal";
    modalRoot.id = "app-modal";
    modalRoot.hidden = true;
    modalRoot.innerHTML =
      '<div class="modal-backdrop" data-modal-close></div>' +
      '<div class="modal-card" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button type="button" class="modal-close" data-modal-close aria-label="Close dialog">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      "</button>" +
      '<div class="modal-content"></div>' +
      "</div>";
    document.body.appendChild(modalRoot);
    modalRoot.addEventListener("click", function (event) {
      if (event.target.closest("[data-modal-close]")) closeModal(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modalRoot && !modalRoot.hidden) {
        closeModal(false);
      }
    });
    return modalRoot;
  }

  function openModal(content, options) {
    const opts = options || {};
    ensureModal();
    const card = modalRoot.querySelector(".modal-card");
    const holder = modalRoot.querySelector(".modal-content");
    card.classList.toggle("is-wide", Boolean(opts.wide));
    holder.innerHTML = "";
    if (typeof content === "string") holder.innerHTML = content;
    else holder.appendChild(content);
    modalOnClose = typeof opts.onClose === "function" ? opts.onClose : null;
    modalRoot.hidden = false;
    document.documentElement.classList.add("modal-open");
    card.focus({ preventScroll: true });
  }

  function closeModal(result) {
    if (!modalRoot || modalRoot.hidden) return;
    modalRoot.hidden = true;
    modalRoot.querySelector(".modal-content").innerHTML = "";
    document.documentElement.classList.remove("modal-open");
    const callback = modalOnClose;
    modalOnClose = null;
    if (callback) callback(result);
  }

  function confirm(options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      let settled = false;
      const node = document.createElement("div");
      node.className = "confirm-dialog";
      node.innerHTML =
        '<h2 class="confirm-title">' +
        escapeHtml(opts.title || "Are you sure?") +
        "</h2>" +
        '<p class="confirm-message">' +
        escapeHtml(opts.message || "") +
        "</p>" +
        '<div class="confirm-actions">' +
        '<button type="button" class="btn btn-ghost" data-confirm-cancel>Cancel</button>' +
        '<button type="button" class="btn ' +
        (opts.danger ? "btn-danger" : "btn-primary") +
        '" data-confirm-ok>' +
        escapeHtml(opts.confirmLabel || "Confirm") +
        "</button>" +
        "</div>";
      openModal(node, {
        onClose: function () {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });
      node
        .querySelector("[data-confirm-cancel]")
        .addEventListener("click", function () {
          settled = true;
          closeModal();
          resolve(false);
        });
      node
        .querySelector("[data-confirm-ok]")
        .addEventListener("click", function () {
          settled = true;
          closeModal();
          resolve(true);
        });
    });
  }

  /* ---------------------------------------------------------------- images */
  function crossfade(imgEl, newSrc) {
    if (!imgEl) return;
    if ((imgEl.getAttribute("src") || "") === newSrc) return;
    imgEl.classList.add("is-fading");
    const token = String(Date.now()) + Math.random();
    imgEl.dataset.fadeToken = token;
    const preloader = new Image();
    function finish() {
      if (imgEl.dataset.fadeToken !== token) return;
      imgEl.src = newSrc;
      requestAnimationFrame(function () {
        if (imgEl.dataset.fadeToken === token) {
          imgEl.classList.remove("is-fading");
        }
      });
    }
    preloader.onload = finish;
    preloader.onerror = finish;
    preloader.src = newSrc;
  }

  /* ---------------------------------------------------------------- weather */
  let weatherListener = null;
  let weatherInFlight = null;

  function getBrowserPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (position) {
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        function () {
          resolve(null);
        },
        { timeout: 5000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  async function browserCoords() {
    if (!navigator.permissions || !navigator.permissions.query) return null;
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "granted") return await getBrowserPosition();
    } catch (err) {
      return null;
    }
    return null;
  }

  async function fetchWeather() {
    const coords = await browserCoords();
    const query = coords
      ? "?lat=" + encodeURIComponent(coords.lat) + "&lon=" + encodeURIComponent(coords.lon)
      : "";
    return API.get("/api/weather" + query);
  }

  function renderWeatherChip(data) {
    const chip = document.getElementById("weather-chip");
    if (!chip) return;
    chip.classList.remove("is-loading");
    if (!data || !data.weather) {
      chip.classList.add("is-warn");
      chip.innerHTML =
        '<span class="chip-emoji" aria-hidden="true">\ud83c\udf21\ufe0f</span>' +
        '<span class="chip-temp">\u2014</span>' +
        '<span class="chip-kind">weather off</span>';
      chip.setAttribute("aria-label", "Weather unavailable. Tap to retry.");
      chip.title = "Weather unavailable. Tap to retry.";
      return;
    }
    chip.classList.remove("is-warn");
    chip.classList.toggle("is-stale", Boolean(data.stale));
    const temp = temperatureOf(data);
    const emoji = data.emoji || weatherEmoji(data.code);
    chip.innerHTML =
      '<span class="chip-emoji" aria-hidden="true">' +
      escapeHtml(emoji) +
      '</span><span class="chip-temp">' +
      (temp === null ? "\u2014" : temp + "\u00b0") +
      '</span><span class="chip-kind">' +
      escapeHtml(data.weather) +
      "</span>";
    const parts = [
      data.label || "",
      temp === null ? "" : temp + "\u00b0",
      sourceLabel(data.source),
      data.stale ? "stale" : "",
    ].filter(Boolean);
    chip.title = parts.join(" \u00b7 ");
    chip.setAttribute(
      "aria-label",
      "Weather: " + parts.join(", ") + ". Tap to refresh."
    );
  }

  async function loadWeatherAndRender() {
    if (weatherInFlight) return weatherInFlight;
    const chip = document.getElementById("weather-chip");
    if (chip) chip.classList.add("is-loading");
    weatherInFlight = (async function () {
      try {
        const data = await fetchWeather();
        renderWeatherChip(data);
        if (weatherListener) weatherListener(data);
        return data;
      } catch (err) {
        renderWeatherChip(null);
        if (weatherListener) weatherListener(null);
        return null;
      } finally {
        weatherInFlight = null;
        if (chip) chip.classList.remove("is-loading");
      }
    })();
    return weatherInFlight;
  }

  function initWeatherChip(options) {
    const opts = options || {};
    weatherListener = typeof opts.onData === "function" ? opts.onData : null;
    const chip = document.getElementById("weather-chip");
    if (chip && !chip.dataset.bound) {
      chip.dataset.bound = "1";
      chip.addEventListener("click", function () {
        loadWeatherAndRender();
      });
    }
    return loadWeatherAndRender();
  }

  window.UI = {
    escapeHtml: escapeHtml,
    imgUrl: imgUrl,
    itemImage: itemImage,
    parseDbDate: parseDbDate,
    timeAgo: timeAgo,
    formatDate: formatDate,
    dayKey: dayKey,
    relativeDayLabel: relativeDayLabel,
    weatherEmoji: weatherEmoji,
    temperatureOf: temperatureOf,
    sourceLabel: sourceLabel,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirm: confirm,
    crossfade: crossfade,
    renderWeatherChip: renderWeatherChip,
    refreshWeather: loadWeatherAndRender,
    initWeatherChip: initWeatherChip,
  };
})();
