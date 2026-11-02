/* Wardrobe page: uploads, horizontal rails, item modal, replace/delete flow. */
(function () {
  "use strict";

  const TYPES = ["top", "bottom", "shoes"];
  const LABEL = { top: "top", bottom: "bottom", shoes: "shoes" };
  const CAP = { top: "Top", bottom: "Bottom", shoes: "Shoes" };
  const PLURAL = { top: "tops", bottom: "bottoms", shoes: "shoes" };
  const WEATHER_LABEL = { cold: "Cold", hot: "Hot", both: "Hot or cold" };
  const MAX_BYTES = 10 * 1024 * 1024;
  const ALLOWED = ["jpg", "jpeg", "png", "webp", "gif"];

  function weatherLabel(value) {
    return WEATHER_LABEL[value] || value || "";
  }

  function weatherCompatible(a, b) {
    return a === b || a === "both" || b === "both";
  }

  const state = {
    weather: null,
    todayKind: "cold",
    items: { top: [], bottom: [], shoes: [] },
    selectedFile: null,
    previewUrl: null,
    busy: false,
    deleteContext: null,
  };

  let els = {};

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function esc(value) {
    return UI.escapeHtml(value);
  }

  function checkedValue(name) {
    const input = document.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : null;
  }

  /* --------------------------------------------------------------- data load */
  async function loadAll() {
    try {
      const results = await Promise.all(
        TYPES.map(function (type) {
          return API.get("/api/items?type=" + type);
        })
      );
      TYPES.forEach(function (type, index) {
        state.items[type] = results[index] || [];
      });
      TYPES.forEach(renderRail);
      updateCount();
    } catch (err) {
      UI.toast(err.message, "error");
    }
  }

  function updateCount() {
    const total = TYPES.reduce(function (sum, type) {
      return sum + state.items[type].length;
    }, 0);
    if (els.count) {
      els.count.textContent =
        total + (total === 1 ? " piece" : " pieces");
    }
  }

  /* ------------------------------------------------------------------ rails */
  function renderRail(type) {
    const rail = document.getElementById("rail-" + type);
    const empty = document.querySelector('[data-empty="' + type + '"]');
    const count = document.querySelector('[data-count="' + type + '"]');
    if (!rail) return;

    const items = state.items[type] || [];
    if (count) count.textContent = items.length;
    if (empty) empty.hidden = items.length > 0;

    rail.innerHTML = "";
    items.forEach(function (item) {
      const description = item.description || "Untitled " + LABEL[type];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb";
      button.setAttribute(
        "aria-label",
        "Open " + CAP[type].toLowerCase() + ": " + description
      );
      button.innerHTML =
        '<span class="thumb-media">' +
        '<img src="' +
        esc(UI.itemImage(item)) +
        '" alt="" loading="lazy" />' +
        '<span class="thumb-weather">' +
        esc(item.weather) +
        "</span></span>" +
        '<span class="thumb-desc" title="' +
        esc(description) +
        '">' +
        esc(description) +
        "</span>";
      button.addEventListener("click", function () {
        openItem(item);
      });
      rail.appendChild(button);
    });

    requestAnimationFrame(function () {
      updateRailButtons(type);
    });
  }

  function updateRailButtons(type) {
    const rail = document.getElementById("rail-" + type);
    if (!rail) return;
    const prev = document.querySelector(
      '.rail-prev[data-rail="' + type + '"]'
    );
    const next = document.querySelector(
      '.rail-next[data-rail="' + type + '"]'
    );
    const max = rail.scrollWidth - rail.clientWidth;
    if (prev) prev.disabled = rail.scrollLeft <= 2 || max <= 2;
    if (next) next.disabled = rail.scrollLeft >= max - 2 || max <= 2;
  }

  function wireRails() {
    document.querySelectorAll(".rail-btns .icon-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        const type = button.dataset.rail;
        const rail = document.getElementById("rail-" + type);
        if (!rail) return;
        const direction = button.classList.contains("rail-prev") ? -1 : 1;
        rail.scrollBy({ left: direction * 408, behavior: "smooth" });
      });
    });

    TYPES.forEach(function (type) {
      const rail = document.getElementById("rail-" + type);
      if (rail) {
        rail.addEventListener("scroll", function () {
          updateRailButtons(type);
        });
      }
    });

    window.addEventListener("resize", function () {
      TYPES.forEach(updateRailButtons);
    });
  }

  /* ----------------------------------------------------------------- upload */
  function showError(message) {
    if (!els.uploadError) return;
    els.uploadError.textContent = message;
    els.uploadError.hidden = false;
  }

  function clearError() {
    if (!els.uploadError) return;
    els.uploadError.textContent = "";
    els.uploadError.hidden = true;
  }

  function clearFile() {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
    state.selectedFile = null;
    if (els.fileInput) els.fileInput.value = "";
    if (els.preview) {
      els.preview.hidden = true;
      els.preview.removeAttribute("src");
    }
    if (els.prompt) els.prompt.hidden = false;
    if (els.previewClear) els.previewClear.hidden = true;
    if (els.dropzone) els.dropzone.classList.remove("has-preview");
  }

  function pickFile(file) {
    clearError();
    if (!file) return;

    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (extension === "heic" || extension === "heif") {
      showError(
        "HEIC/HEIF photos are not supported. Export the photo as JPG or PNG first."
      );
      return;
    }
    if (
      ALLOWED.indexOf(extension) === -1 ||
      (file.type && file.type.indexOf("image/") !== 0)
    ) {
      showError("Unsupported file type. Use JPG, PNG, WEBP, or GIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError("Image is larger than 10 MB.");
      return;
    }

    clearFile();
    state.selectedFile = file;
    state.previewUrl = URL.createObjectURL(file);
    if (els.preview) {
      els.preview.src = state.previewUrl;
      els.preview.hidden = false;
    }
    if (els.prompt) els.prompt.hidden = true;
    if (els.previewClear) els.previewClear.hidden = false;
    if (els.dropzone) els.dropzone.classList.add("has-preview");
  }

  function wireUpload() {
    if (!els.dropzone) return;

    els.dropzone.addEventListener("click", function () {
      els.fileInput.click();
    });

    els.dropzone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        els.fileInput.click();
      }
    });

    els.fileInput.addEventListener("change", function () {
      pickFile(els.fileInput.files && els.fileInput.files[0]);
    });

    ["dragenter", "dragover"].forEach(function (name) {
      els.dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        els.dropzone.classList.add("is-dragging");
      });
    });

    els.dropzone.addEventListener("dragleave", function (event) {
      if (!els.dropzone.contains(event.relatedTarget)) {
        els.dropzone.classList.remove("is-dragging");
      }
    });

    els.dropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      els.dropzone.classList.remove("is-dragging");
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      pickFile(file);
    });

    document.addEventListener("dragover", function (event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("drop", function (event) {
      event.preventDefault();
    });

    if (els.previewClear) {
      els.previewClear.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        clearFile();
      });
    }

    els.form.addEventListener("submit", submitUpload);
  }

  function setUploading(busy) {
    state.busy = busy;
    if (els.uploadBtn) {
      els.uploadBtn.disabled = busy;
      els.uploadBtn.textContent = busy ? "Uploading…" : "Upload piece";
    }
    if (els.progress) els.progress.hidden = !busy;
    if (!busy && els.bar) {
      setTimeout(function () {
        if (els.bar) els.bar.style.width = "0%";
      }, 260);
    }
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (state.busy) return;
    clearError();

    const weather = checkedValue("weather");
    const type = checkedValue("type");
    const description = (els.description.value || "").trim();

    if (!state.selectedFile) {
      showError("Choose an image to upload.");
      return;
    }
    if (!weather || !type) {
      showError("Pick a weather and a type.");
      return;
    }

    const formData = new FormData();
    formData.append("file", state.selectedFile);
    formData.append("description", description);
    formData.append("weather", weather);
    formData.append("type", type);

    setUploading(true);
    if (els.bar) els.bar.style.width = "0%";

    try {
      await API.upload("/api/items", formData, function (progress) {
        if (els.bar) {
          els.bar.style.width = Math.max(4, Math.round(progress * 100)) + "%";
        }
      });
      if (els.bar) els.bar.style.width = "100%";
      UI.toast("Added to " + PLURAL[type] + ".", "success");
      clearFile();
      els.description.value = "";
      await loadAll();
    } catch (err) {
      showError(err.message);
    } finally {
      setUploading(false);
    }
  }

  /* ------------------------------------------------------------------- scan */
  async function scanFolders(manual) {
    if (els.scanBtn) {
      els.scanBtn.disabled = true;
      els.scanBtn.textContent = "Scanning…";
    }
    try {
      const result = await API.post("/api/items/sync");
      if (result && result.imported) {
        UI.toast(
          "Imported " +
            result.imported +
            " " +
            (result.imported === 1 ? "piece" : "pieces") +
            " from the folders.",
          "success"
        );
      } else if (manual) {
        UI.toast("No new images found in the folders.", "info");
      }
      if (result && result.errors && result.errors.length) {
        UI.toast(
          "Skipped " +
            result.errors.length +
            " file(s): " +
            result.errors[0].error,
          "error"
        );
      }
      return result;
    } catch (err) {
      if (manual) UI.toast(err.message, "error");
      return null;
    } finally {
      if (els.scanBtn) {
        els.scanBtn.disabled = false;
        els.scanBtn.textContent = "Scan folders";
      }
    }
  }

  function wireScan() {
    if (!els.scanBtn) return;
    els.scanBtn.addEventListener("click", function () {
      scanFolders(true).then(function (result) {
        if (result && result.imported) loadAll();
      });
    });
  }

  /* ------------------------------------------------------------------ modal */
  function openItem(item) {
    const description = item.description || "Untitled " + LABEL[item.type];
    const node = document.createElement("div");
    node.className = "item-modal";
    node.innerHTML =
      '<div class="item-modal-media">' +
      '<img src="' +
      esc(UI.itemImage(item)) +
      '" alt="' +
      esc(description) +
      '" /></div>' +
      '<div class="item-modal-info">' +
      '<div class="pill-row">' +
      '<span class="pill pill-cat">' +
      esc(CAP[item.type]) +
      "</span>" +
      '<span class="pill pill-' +
      esc(item.weather) +
      '">' +
      esc(weatherLabel(item.weather)) +
      " weather</span></div>" +
      '<h2 class="item-title">' +
      esc(description) +
      "</h2>" +
      '<p class="item-description">' +
      (item.description
        ? esc(item.description)
        : "No description yet. You can re-upload this piece with notes later.") +
      "</p>" +
      '<p class="item-meta">Added ' +
      esc(UI.formatDate(item.createdAt)) +
      " \u00b7 " +
      esc(CAP[item.type]) +
      " \u00b7 " +
      esc(weatherLabel(item.weather)) +
      " weather</p>" +
      '<div class="item-actions">' +
      '<button class="btn btn-quiet-danger" type="button" data-delete>Delete piece</button>' +
      "</div></div>";
    UI.openModal(node, { wide: true });
    node
      .querySelector("[data-delete]")
      .addEventListener("click", function () {
        beginDelete(item);
      });
  }

  async function beginDelete(item) {
    const description = item.description
      ? '"' + item.description + '"'
      : "This " + LABEL[item.type];
    const ok = await UI.confirm({
      title: "Delete this " + LABEL[item.type] + "?",
      message:
        description +
        " will be removed from your wardrobe. If saved outfits use it, you'll get a chance to swap it first.",
      confirmLabel: "Delete piece",
      danger: true,
    });
    if (!ok) return;
    await attemptDelete(item);
  }

  async function attemptDelete(item) {
    try {
      await API.del("/api/items/" + item.id);
      UI.closeModal();
      UI.toast("Piece deleted.", "success");
      await loadAll();
    } catch (err) {
      if (
        err.status === 409 &&
        err.body &&
        Array.isArray(err.body.affectedOutfits)
      ) {
        showDeleteFlow(item, err.body.affectedOutfits);
      } else {
        UI.toast(err.message, "error");
      }
    }
  }

  /* ------------------------------------------------------- replace / delete */
  function affectedRow(outfit) {
    const thumbs = ["top", "bottom", "shoes"]
      .map(function (key) {
        const item = outfit[key];
        if (!item) return '<span class="affected-missing">?</span>';
        return (
          '<img src="' +
          esc(UI.itemImage(item)) +
          '" alt="" title="' +
          esc(item.description || key) +
          '" />'
        );
      })
      .join("");
    return (
      '<div class="affected-row">' +
      thumbs +
      '<span class="affected-label">' +
      esc(UI.formatDate(outfit.createdAt)) +
      " \u00b7 " +
      esc(outfit.weather) +
      "</span></div>"
    );
  }

  function showDeleteFlow(item, affected) {
    const candidates = (state.items[item.type] || []).filter(function (entry) {
      return entry.id !== item.id;
    });
    const context = {
      item: item,
      affected: affected,
      candidates: candidates,
      matchWeather: true,
      selectedId: null,
    };
    state.deleteContext = context;

    const outfitWord = affected.length === 1 ? "outfit" : "outfits";
    const node = document.createElement("div");
    node.className = "delete-flow";
    node.innerHTML =
      '<span class="flow-kicker">Used in ' +
      affected.length +
      " " +
      outfitWord +
      "</span>" +
      "<h2>This " +
      esc(LABEL[item.type]) +
      " appears in " +
      affected.length +
      " saved " +
      outfitWord +
      ".</h2>" +
      "<p>Swap it for another piece to keep those looks intact, or delete them along with it. Nothing changes until you confirm.</p>" +
      '<div class="flow-options">' +
      '<div class="option-card">' +
      '<h3><span class="option-letter">A</span> Replace it</h3>' +
      "<p>Saved outfits keep working, now using the piece you choose below.</p>" +
      '<label class="toggle"><input type="checkbox" id="match-weather" checked />' +
      '<span class="toggle-track"></span>Only show ' +
      esc(weatherLabel(item.weather).toLowerCase()) +
      "-weather " +
      esc(PLURAL[item.type]) +
      "</label>" +
      '<div class="candidate-grid" id="candidate-grid"></div>' +
      '<div class="flow-actions"><button class="btn btn-primary" type="button" id="replace-delete">Replace &amp; delete</button></div>' +
      "</div>" +
      '<div class="option-card is-danger">' +
      '<h3><span class="option-letter">B</span> Delete the ' + outfitWord + ' too</h3>' +
      "<p>This cannot be undone. These looks will be removed:</p>" +
      '<div class="affected-list">' +
      affected.map(affectedRow).join("") +
      "</div>" +
      '<div class="flow-actions"><button class="btn btn-danger" type="button" id="force-delete">Delete item + ' +
      affected.length +
      " " +
      outfitWord +
      "</button></div>" +
      "</div>" +
      "</div>" +
      '<div class="flow-actions"><button class="btn btn-ghost" type="button" id="cancel-delete">Cancel</button></div>';

    UI.openModal(node, { wide: true });

    const grid = node.querySelector("#candidate-grid");
    const replaceButton = node.querySelector("#replace-delete");
    const matchToggle = node.querySelector("#match-weather");

    function renderCandidates() {
      context.matchWeather = matchToggle.checked;
      const list = context.candidates.filter(function (candidate) {
        return (
          !context.matchWeather ||
          weatherCompatible(candidate.weather, item.weather)
        );
      });

      if (!list.length) {
        grid.innerHTML =
          '<p class="candidate-empty">No other ' +
          esc(PLURAL[item.type]) +
          (context.matchWeather
            ? " tagged " + esc(weatherLabel(item.weather).toLowerCase())
            : "") +
          " available. Add another piece or turn off the filter.</p>";
        replaceButton.disabled = true;
        context.selectedId = null;
        return;
      }

      const stillValid = list.some(function (candidate) {
        return candidate.id === context.selectedId;
      });
      if (!stillValid) context.selectedId = list[0].id;
      replaceButton.disabled = false;

      grid.innerHTML = list
        .map(function (candidate) {
          const description =
            candidate.description || "Untitled " + LABEL[item.type];
          return (
            '<label class="candidate">' +
            '<input type="radio" name="replacement" value="' +
            candidate.id +
            '"' +
            (candidate.id === context.selectedId ? " checked" : "") +
            " />" +
            '<span class="candidate-media">' +
            '<img src="' +
            esc(UI.itemImage(candidate)) +
            '" alt="' +
            esc(description) +
            '" />' +
            '<span class="candidate-check">\u2713</span></span>' +
            '<span class="candidate-desc">' +
            esc(description) +
            "</span></label>"
          );
        })
        .join("");

      grid
        .querySelectorAll('input[name="replacement"]')
        .forEach(function (input) {
          input.addEventListener("change", function () {
            context.selectedId = Number(input.value);
          });
        });
    }

    matchToggle.addEventListener("change", renderCandidates);
    renderCandidates();

    replaceButton.addEventListener("click", async function () {
      if (!context.selectedId) {
        UI.toast("Choose a replacement piece first.", "info");
        return;
      }
      replaceButton.disabled = true;
      replaceButton.textContent = "Replacing…";
      try {
        await API.post("/api/items/" + item.id + "/replace", {
          replacementId: context.selectedId,
        });
        await API.del("/api/items/" + item.id + "?force=true");
        UI.closeModal();
        UI.toast("Piece replaced and deleted.", "success");
        await loadAll();
      } catch (err) {
        UI.toast(err.message, "error");
        replaceButton.disabled = false;
        replaceButton.textContent = "Replace & delete";
      }
    });

    node
      .querySelector("#force-delete")
      .addEventListener("click", async function () {
        const button = node.querySelector("#force-delete");
        button.disabled = true;
        button.textContent = "Deleting…";
        try {
          await API.del("/api/items/" + item.id + "?force=true");
          UI.closeModal();
          UI.toast(
            "Piece and " +
              affected.length +
              " " +
              (affected.length === 1 ? "outfit" : "outfits") +
              " deleted.",
            "success"
          );
          await loadAll();
        } catch (err) {
          UI.toast(err.message, "error");
          button.disabled = false;
          button.textContent = "Delete item + " + affected.length + " " + outfitWord;
        }
      });

    node
      .querySelector("#cancel-delete")
      .addEventListener("click", function () {
        UI.closeModal();
      });
  }

  /* -------------------------------------------------------------------- init */
  async function init() {
    els = {
      form: document.getElementById("upload-form"),
      fileInput: document.getElementById("file-input"),
      dropzone: document.getElementById("dropzone"),
      prompt: document.getElementById("dropzone-prompt"),
      preview: document.getElementById("file-preview"),
      previewClear: document.getElementById("preview-clear"),
      description: document.getElementById("description"),
      uploadBtn: document.getElementById("upload-btn"),
      progress: document.getElementById("upload-progress"),
      bar: document.getElementById("upload-bar"),
      uploadError: document.getElementById("upload-error"),
      count: document.getElementById("wardrobe-count"),
      scanBtn: document.getElementById("scan-folders"),
    };

    wireRails();
    wireUpload();
    wireScan();

    let weather = null;
    try {
      weather = await UI.initWeatherChip();
    } catch (err) {
      weather = null;
    }
    state.weather = weather;
    state.todayKind = weather && weather.weather ? weather.weather : "cold";
    const weatherInput = document.querySelector(
      'input[name="weather"][value="' + state.todayKind + '"]'
    );
    if (weatherInput) weatherInput.checked = true;

    await scanFolders(false);
    await loadAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
