export default function StatusBar({ statusMessage, errorMessage, summary, sourceName, busyLabel, toasts }) {
  const hasError = Boolean(errorMessage);

  return (
    <>
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <article key={toast.id} className={`toast-card ${toast.type}`}>
            <span className="toast-dot" />
            <div>
              <strong>{toast.type === "error" ? "Notice" : "Status"}</strong>
              <p>{toast.message}</p>
            </div>
          </article>
        ))}
      </div>

      <div className={`status-bar status-bar-editorial${hasError ? " error" : ""}`}>
        <div className="status-bar-main">
          <span className="status-pill">{busyLabel ? "WORKING" : hasError ? "ATTENTION" : "READY"}</span>
          <p>{errorMessage || busyLabel || statusMessage}</p>
        </div>
        <div className="status-bar-meta">
          <span>{summary}</span>
          <span>{sourceName}</span>
        </div>
      </div>
    </>
  );
}
