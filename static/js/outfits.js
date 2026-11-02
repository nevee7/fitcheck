/* Outfits page: grouped saved looks, weather hints, and removal. */
(function () {
  "use strict";

  const KEYS = ["top", "bottom", "shoes"];
  const LABEL = { top: "Top", bottom: "Bottom", shoes: "Shoes" };

  const state = {
    outfits: [],
    todayKind: null,
    loaded: false,
  };

  let els = {};

  function esc(value) {
    return UI.escapeHtml(value);
  }

  function outfitCard(outfit) {
    const node = document.createElement("article");
    node.className = "outfit-card";

    const figures = KEYS.map(function (key) {
      const item = outfit[key];
      const label = LABEL[key];
      if (!item) {
        return (
          '<figure class="outfit-figure">' +
          '<div class="img-missing" aria-hidden="true">?</div>' +
          "<figcaption>" +
          label +
          "</figcaption></figure>"
        );
      }
      return (
        '<figure class="outfit-figure">' +
        '<img src="' +
        esc(UI.itemImage(item)) +
        '" alt="' +
        esc(item.description || label) +
        '" loading="lazy" />' +
        "<figcaption>" +
        label +
        "</figcaption></figure>"
      );
    }).join("");

    let hint;
    if (state.todayKind && outfit.weather !== state.todayKind) {
      hint =
        "Made for <strong>" +
        esc(outfit.weather) +
        "</strong> \u00b7 today is <strong>" +
        esc(state.todayKind) +
        "</strong>";
    } else if (state.todayKind) {
      hint = "Fits today's weather.";
    } else {
      hint = "Made for <strong>" + esc(outfit.weather) + "</strong> weather.";
    }

    node.innerHTML =
      '<div class="outfit-imgs">' +
      figures +
      "</div>" +
      '<div class="outfit-foot">' +
      '<span class="pill pill-' +
      esc(outfit.weather) +
      '">' +
      esc(outfit.weather) +
      "</span>" +
      '<span class="outfit-hint">' +
      hint +
      "</span>" +
      '<button class="icon-btn outfit-remove" type="button" data-remove aria-label="Remove this outfit">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M6 6l12 12M18 6L6 18" /></svg>' +
      "</button>" +
      "</div>";

    node
      .querySelector("[data-remove]")
      .addEventListener("click", function () {
        removeOutfit(outfit);
      });

    return node;
  }

  async function removeOutfit(outfit) {
    const ok = await UI.confirm({
      title: "Remove this look?",
      message:
        "The outfit will disappear from this page. The individual pieces stay in your wardrobe.",
      confirmLabel: "Remove look",
      danger: true,
    });
    if (!ok) return;

    try {
      await API.del("/api/outfits/" + outfit.id);
      state.outfits = state.outfits.filter(function (entry) {
        return entry.id !== outfit.id;
      });
      render();
      UI.toast("Outfit removed.", "success");
    } catch (err) {
      UI.toast(err.message, "error");
    }
  }

  function emptyState() {
    return (
      '<div class="empty-page">' +
      '<span class="empty-icon" aria-hidden="true">\u2661</span>' +
      "<h2>No outfits yet</h2>" +
      "<p>Hit Generate on the main page, then tap the heart to save a combination. Your saved looks will collect here, grouped by day.</p>" +
      '<a class="btn btn-primary" href="/">Generate a look</a>' +
      "</div>"
    );
  }

  function render() {
    if (!els.groups) return;
    els.groups.innerHTML = "";

    const count = state.outfits.length;
    if (els.count) {
      els.count.textContent = count + (count === 1 ? " look" : " looks");
    }

    if (!count) {
      els.groups.innerHTML = emptyState();
      return;
    }

    const groups = new Map();
    state.outfits.forEach(function (outfit) {
      const key = UI.dayKey(outfit.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(outfit);
    });

    groups.forEach(function (outfits, key) {
      const section = document.createElement("section");
      section.className = "outfit-group";
      const heading = document.createElement("div");
      heading.className = "date-heading";
      const title = document.createElement("h2");
      title.textContent = UI.relativeDayLabel(key);
      heading.appendChild(title);
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "outfit-grid";
      outfits.forEach(function (outfit) {
        grid.appendChild(outfitCard(outfit));
      });
      section.appendChild(grid);
      els.groups.appendChild(section);
    });
  }

  async function init() {
    els = {
      groups: document.getElementById("outfits-groups"),
      count: document.getElementById("outfits-count"),
    };

    let weather = null;
    try {
      weather = await UI.initWeatherChip({
        onData: function (data) {
          state.todayKind = data && data.weather ? data.weather : null;
          if (state.loaded) render();
        },
      });
    } catch (err) {
      weather = null;
    }
    state.todayKind = weather && weather.weather ? weather.weather : null;

    try {
      state.outfits = await API.get("/api/outfits");
    } catch (err) {
      state.outfits = [];
      UI.toast(err.message, "error");
    }
    state.loaded = true;
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
