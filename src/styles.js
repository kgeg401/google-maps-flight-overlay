export const OVERLAY_STYLES = `
  #gm-flight-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    pointer-events: none;
    font-family: "Segoe UI", Tahoma, sans-serif;
    color: #f3f7ff;
  }

  #gm-flight-overlay-canvas {
    position: fixed;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  #gm-flight-overlay-badge {
    position: fixed;
    right: 14px;
    top: 14px;
    max-width: 280px;
    pointer-events: none;
    border: 1px solid rgba(120, 190, 255, 0.18);
    background: rgba(5, 10, 18, 0.86);
    border-radius: 14px;
    padding: 8px 11px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(10px);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: 0.02em;
    white-space: pre-line;
  }

  #gm-flight-overlay-badge[data-level="ok"] {
    border-color: rgba(83, 216, 141, 0.3);
  }

  #gm-flight-overlay-badge[data-level="warn"] {
    border-color: rgba(255, 209, 102, 0.34);
  }

  #gm-flight-overlay-badge[data-level="error"] {
    border-color: rgba(255, 107, 107, 0.38);
  }

  #gm-flight-overlay-launcher {
    position: fixed;
    left: 16px;
    bottom: 16px;
    min-width: 140px;
    height: 58px;
    padding: 0 18px 0 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    cursor: pointer;
    border: 1px solid rgba(120, 190, 255, 0.26);
    border-radius: 999px;
    background:
      radial-gradient(circle at top left, rgba(89, 215, 255, 0.12), transparent 45%),
      linear-gradient(180deg, rgba(10, 18, 31, 0.96), rgba(5, 10, 18, 0.98));
    color: #f3f7ff;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(10px);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.03em;
    user-select: none;
  }

  #gm-flight-overlay-launcher[data-open="true"] {
    border-color: rgba(89, 215, 255, 0.44);
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28), 0 0 0 3px rgba(89, 215, 255, 0.14);
  }

  .gm-flight-overlay-launcher-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(89, 215, 255, 0.12);
    font-size: 16px;
  }

  .gm-flight-overlay-panel {
    position: fixed;
    width: min(360px, calc(100vw - 24px));
    pointer-events: auto;
    border: 1px solid rgba(120, 190, 255, 0.2);
    background:
      radial-gradient(circle at top left, rgba(89, 215, 255, 0.08), transparent 38%),
      linear-gradient(180deg, rgba(9, 16, 27, 0.96), rgba(5, 10, 18, 0.97));
    color: #f3f7ff;
    border-radius: 16px;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    overflow: hidden;
    display: none;
  }

  .gm-flight-overlay-panel[data-open="true"] {
    display: flex;
    flex-direction: column;
  }

  .gm-flight-overlay-panel[data-panel="details"] {
    width: min(396px, calc(100vw - 24px));
  }

  .gm-flight-overlay-panel[data-panel="logs"] {
    width: min(540px, calc(100vw - 24px));
    max-height: min(58vh, 520px);
  }

  .gm-flight-overlay-panel[data-panel="debug"] {
    width: min(400px, calc(100vw - 24px));
    max-height: min(56vh, 480px);
  }

  .gm-flight-overlay-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(120, 190, 255, 0.12);
    cursor: grab;
    user-select: none;
  }

  .gm-flight-overlay-panel-header:active {
    cursor: grabbing;
  }

  .gm-flight-overlay-panel-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .gm-flight-overlay-panel-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gm-flight-overlay-button,
  .gm-flight-overlay-field,
  .gm-flight-overlay-select,
  .gm-flight-overlay-textarea {
    border: 1px solid rgba(120, 190, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #f3f7ff;
    border-radius: 10px;
    font: inherit;
  }

  .gm-flight-overlay-button {
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
    line-height: 1.2;
  }

  .gm-flight-overlay-button:hover {
    background: rgba(89, 215, 255, 0.12);
  }

  .gm-flight-overlay-button[data-variant="danger"] {
    border-color: rgba(255, 107, 107, 0.28);
  }

  .gm-flight-overlay-panel-body {
    padding: 12px;
    overflow: auto;
  }

  .gm-flight-overlay-menu-grid {
    display: grid;
    gap: 10px;
  }

  .gm-flight-overlay-menu-info,
  .gm-flight-overlay-debug-summary,
  .gm-flight-overlay-details-note {
    border: 1px solid rgba(120, 190, 255, 0.14);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 10px 11px;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-line;
  }

  .gm-flight-overlay-action-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .gm-flight-overlay-log-body,
  .gm-flight-overlay-debug-log,
  .gm-flight-overlay-textarea {
    font-family: Consolas, "Courier New", monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .gm-flight-overlay-log-body,
  .gm-flight-overlay-debug-log {
    overflow: auto;
  }

  .gm-flight-overlay-details-card {
    display: grid;
    gap: 12px;
  }

  .gm-flight-overlay-details-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .gm-flight-overlay-details-subtitle {
    color: rgba(243, 247, 255, 0.7);
    font-size: 13px;
    line-height: 1.4;
  }

  .gm-flight-overlay-details-photo,
  .gm-flight-overlay-details-photo-placeholder {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 12px;
    border: 1px solid rgba(120, 190, 255, 0.18);
    background: rgba(255, 255, 255, 0.03);
  }

  .gm-flight-overlay-details-photo-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    text-align: center;
    color: rgba(243, 247, 255, 0.72);
    font-size: 12px;
  }

  .gm-flight-overlay-details-grid {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
  }

  .gm-flight-overlay-details-key {
    color: rgba(243, 247, 255, 0.62);
    font-weight: 600;
  }

  .gm-flight-overlay-details-value {
    color: #f3f7ff;
  }

  .gm-flight-overlay-settings-grid {
    display: grid;
    gap: 12px;
  }

  .gm-flight-overlay-settings-row {
    display: grid;
    gap: 6px;
  }

  .gm-flight-overlay-settings-row label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(243, 247, 255, 0.82);
  }

  .gm-flight-overlay-field,
  .gm-flight-overlay-select {
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
  }

  .gm-flight-overlay-textarea {
    width: 100%;
    min-height: 120px;
    padding: 10px;
    resize: vertical;
  }

  .gm-flight-overlay-settings-actions,
  .gm-flight-overlay-debug-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  #gm-flight-overlay-tooltip {
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    min-width: 170px;
    max-width: 280px;
    border-radius: 10px;
    border: 1px solid rgba(120, 190, 255, 0.22);
    background: rgba(6, 10, 18, 0.92);
    color: #f3f7ff;
    padding: 8px 10px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
    font-size: 12px;
    line-height: 1.35;
    white-space: pre-line;
  }
`;
