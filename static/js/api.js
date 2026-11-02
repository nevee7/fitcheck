/* Thin fetch wrappers with consistent error handling. */
(function () {
  "use strict";

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body || null;
    }
  }

  function messageFrom(data, status) {
    if (data) {
      if (typeof data.detail === "string") return data.detail;
      if (data.detail && typeof data.detail.message === "string") {
        return data.detail.message;
      }
      if (Array.isArray(data.detail) && data.detail.length) {
        const first = data.detail[0];
        if (first && typeof first.msg === "string") return first.msg;
      }
    }
    if (status === 0) return "Network error — is the server running?";
    return "Request failed (" + status + ")";
  }

  async function request(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || "GET",
      cache: "no-store",
      headers: Object.assign({}, opts.headers || {}),
    };
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch (err) {
      throw new ApiError("Network error — is the server running?", 0, null);
    }

    if (response.status === 204) return null;

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") !== -1) {
      try {
        data = await response.json();
      } catch (err) {
        data = null;
      }
    }

    if (!response.ok) {
      throw new ApiError(messageFrom(data, response.status), response.status, data);
    }
    return data;
  }

  function upload(path, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.responseType = "text";

      if (xhr.upload && onProgress) {
        xhr.upload.addEventListener("progress", function (event) {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        });
      }

      xhr.addEventListener("load", function () {
        let data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (err) {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new ApiError(messageFrom(data, xhr.status), xhr.status, data));
        }
      });

      xhr.addEventListener("error", function () {
        reject(new ApiError("Network error during upload.", 0, null));
      });

      xhr.send(formData);
    });
  }

  window.API = {
    get: function (path) {
      return request(path);
    },
    post: function (path, body) {
      return request(path, { method: "POST", body: body });
    },
    del: function (path) {
      return request(path, { method: "DELETE" });
    },
    upload: upload,
    ApiError: ApiError,
  };
})();
