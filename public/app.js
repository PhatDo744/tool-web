let token = "";
let dialogGeneration = 0;
const el = (id) => document.getElementById(id);
const messages = {
  UNAUTHORIZED:
    "Mã quản trị không khớp cấu hình của bản deploy hiện tại. Nếu vừa đổi ADMIN_TOKEN trên Vercel, hãy Redeploy rồi thử lại.",
  ADMIN_NOT_CONFIGURED:
    "Máy chủ chưa có ADMIN_TOKEN hợp lệ (tối thiểu 32 ký tự). Đặt biến cho Production trên Vercel rồi Redeploy.",
  SERVICE_UNAVAILABLE: "Chưa kết nối được database. Kiểm tra cấu hình máy chủ.",
  RATE_LIMITED: "Quá nhiều yêu cầu. Vui lòng chờ một phút.",
  INVALID_INPUT: "Thông tin chưa hợp lệ.",
  KEY_STORAGE_NOT_CONFIGURED:
    "Cấu hình ADMIN_TOKEN hợp lệ trên máy chủ để lưu và xem lại key.",
  KEY_DECRYPTION_FAILED:
    "Không giải mã được key. Cấu hình bí mật trên máy chủ đã thay đổi; cần khôi phục giá trị ban đầu.",
  KEY_NOT_RECOVERABLE:
    "Key cũ chỉ có bản băm. Hãy cấp lại key hoặc chờ ứng dụng gửi key để hệ thống lưu bản mã hóa.",
  LICENSE_REVOKED: "Không thể cấp lại key đã thu hồi.",
};
async function api(action, values = {}) {
  const response = await fetch("/api/index", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...values }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      messages[data.error] || data.error || "Có lỗi xảy ra.",
    );
    error.status = response.status;
    if (response.status === 401 && action !== "login" && action !== "session") {
      setAuthenticated(false);
      error.message = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    }
    throw error;
  }
  return data;
}
function notify(message) {
  el("status").textContent = message;
  el("status").dataset.tone = message.startsWith("Đã") ? "success" : "warning";
}
function beginKeyDialog(label) {
  dialogGeneration++;
  el("key-dialog-title").textContent = label ? `Key · ${label}` : "Key sử dụng";
  el("new-key").value = "";
  el("copy").disabled = true;
  el("key-dialog-state").textContent = "Đang tải key...";
  el("generated").hidden = false;
  if (!el("key-dialog").open) el("key-dialog").showModal();
  return dialogGeneration;
}
function showKey(key, label) {
  if (typeof key !== "string" || !/^NRO-[A-F0-9]{48}$/.test(key))
    throw Error("Máy chủ không trả về key hợp lệ.");
  if (!el("key-dialog").open) beginKeyDialog(label);
  el("new-key").value = key;
  el("key-dialog-state").textContent = "";
  el("copy").disabled = false;
}
function clearKeyDialog() {
  dialogGeneration++;
  el("new-key").value = "";
  el("copy").disabled = true;
  el("key-dialog-state").textContent = "";
}
function closeKeyDialog() {
  clearKeyDialog();
  el("key-dialog").close();
}
function setAuthenticated(value) {
  el("login").hidden = value;
  el("dashboard").hidden = !value;
  el("logout").hidden = !value;
  if (!value) {
    token = "";
    el("licenses").replaceChildren();
    closeKeyDialog();
  }
}
async function refresh() {
  const { licenses } = await api("list");
  el("total").textContent = licenses.length;
  el("active").textContent = licenses.filter(
    (l) =>
      l.activated_at && !l.revoked_at && new Date(l.expires_at) > new Date(),
  ).length;
  el("pending").textContent = licenses.filter(
    (l) => !l.activated_at && !l.revoked_at,
  ).length;
  el("licenses").replaceChildren();
  el("empty").hidden = licenses.length > 0;
  for (const l of licenses) {
    const row = document.createElement("tr");
    const state = l.revoked_at
      ? "Đã thu hồi"
      : !l.activated_at
        ? "Chờ kích hoạt"
        : new Date(l.expires_at) <= new Date()
          ? "Hết hạn"
          : "Đang dùng";
    const values = [
      l.label || "Không có ghi chú",
      state,
      `${l.devices}/${l.max_devices}`,
      l.expires_at
        ? new Date(l.expires_at).toLocaleString("vi-VN")
        : `${l.duration_days} ngày sau kích hoạt`,
    ];
    values.forEach((value, index) => {
      const td = document.createElement("td");
      if (index === 1) {
        const badge = document.createElement("span");
        badge.className =
          "pill " +
          (state === "Đang dùng"
            ? ""
            : state === "Chờ kích hoạt"
              ? "muted"
              : "danger");
        badge.textContent = value;
        td.append(badge);
      } else td.textContent = value;
      row.append(td);
    });
    const td = document.createElement("td");
    if (l.recoverable || !l.revoked_at) {
      const view = document.createElement("button");
      view.className = "key-action";
      view.textContent = l.recoverable ? "Xem key" : "Cấp lại key";
      view.title = l.recoverable
        ? "Xem và sao chép key"
        : "Key cũ chưa có bản mã hóa. Cấp lại giữ nguyên hạn dùng.";
      view.onclick = async () => {
        if (
          !l.recoverable &&
          !confirm(
            "Cấp key thay thế? Key cũ sẽ ngừng hoạt động, các thiết bị cần kích hoạt lại. Thời hạn và giới hạn thiết bị giữ nguyên.",
          )
        )
          return;
        view.disabled = true;
        const generation = beginKeyDialog(l.label);
        try {
          const result = await api(l.recoverable ? "reveal" : "rotate", {
            id: l.id,
          });
          if (generation === dialogGeneration && el("key-dialog").open)
            showKey(result.key, l.label);
          if (!l.recoverable) {
            await refresh();
            notify(
              "Đã cấp lại key. Hạn dùng giữ nguyên; key cũ đã ngừng hoạt động.",
            );
          }
        } catch (e) {
          if (generation === dialogGeneration && el("key-dialog").open)
            el("key-dialog-state").textContent = e.message;
          else notify(e.message);
        } finally {
          view.disabled = false;
        }
      };
      td.append(view);
    }
    if (!l.revoked_at) {
      if (l.devices > 0) {
        const reset = document.createElement("button");
        reset.textContent = "Gỡ thiết bị";
        reset.onclick = async () => {
          if (
            !confirm(
              "Gỡ tất cả thiết bị của key này? Hạn dùng giữ nguyên. App phải kích hoạt lại; thiết bị đang chạy sẽ bị từ chối khi kiểm tra tiếp theo.",
            )
          )
            return;
          reset.disabled = true;
          try {
            await api("reset-devices", { id: l.id });
            await refresh();
            notify(
              "Đã gỡ thiết bị. Hãy kích hoạt lại trên ứng dụng mới. Hạn dùng được giữ nguyên.",
            );
          } catch (e) {
            notify(e.message);
            reset.disabled = false;
          }
        };
        td.append(reset);
      }
      const button = document.createElement("button");
      button.textContent = "Thu hồi";
      button.onclick = async () => {
        if (
          !confirm(
            "Thu hồi key này? Ứng dụng sẽ bị từ chối trong lần kiểm tra tiếp theo.",
          )
        )
          return;
        button.disabled = true;
        try {
          await api("revoke", { id: l.id });
          await refresh();
          notify("Đã thu hồi key.");
        } catch (e) {
          notify(e.message);
          button.disabled = false;
        }
      };
      td.append(button);
    }
    row.append(td);
    el("licenses").append(row);
  }
}
el("login-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  token = el("token").value.trim();
  try {
    await api("login");
    token = "";
    el("token").value = "";
    await refresh();
    setAuthenticated(true);
    notify("");
  } catch (error) {
    token = "";
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};
el("logout").onclick = async () => {
  const button = el("logout");
  button.disabled = true;
  try {
    await api("logout");
    setAuthenticated(false);
    notify("Đã đăng xuất.");
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};
el("create-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api("create", {
      label: el("label").value,
      durationDays: Number(el("days").value),
      maxDevices: Number(el("devices").value),
    });
    showKey(result.key, el("label").value);
    notify("Đã tạo key. Bạn có thể xem lại trong danh sách.");
    await refresh();
  } catch (e) {
    notify(e.message);
  } finally {
    button.disabled = false;
  }
};
el("refresh").onclick = () => refresh().catch((e) => notify(e.message));
el("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(el("new-key").value);
    el("key-dialog-state").textContent = "Đã sao chép key.";
  } catch {
    el("new-key").select();
    el("key-dialog-state").textContent = "Chọn và sao chép key trong ô.";
  }
};

el("key-dialog-close").onclick = closeKeyDialog;
el("key-dialog").addEventListener("click", (event) => {
  if (event.target === el("key-dialog")) closeKeyDialog();
});
el("key-dialog").addEventListener("close", () => {
  if (!el("key-dialog").open) clearKeyDialog();
});
(async () => {
  try {
    await api("session");
    await refresh();
    setAuthenticated(true);
  } catch (error) {
    setAuthenticated(false);
    if (error.status !== 401) notify(error.message);
  }
})();
