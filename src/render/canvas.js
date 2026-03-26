export const DEFAULT_CANVAS_THEME = {
  clusterFill: "rgba(255, 209, 102, 0.94)",
  clusterShadow: "rgba(7, 17, 29, 0.28)",
  clusterStroke: "#07111d",
  labelFill: "rgba(6, 10, 18, 0.92)",
  labelStroke: "rgba(120, 190, 255, 0.22)",
  labelText: "#f3f7ff",
  markerColor: "#59d7ff",
  markerHighlightColor: "#ffd166",
  markerSelectedColor: "#9ef3ff",
  markerShadowColor: "rgba(7, 17, 29, 0.28)",
  markerStrokeColor: "#07111d",
  spiderfyLineColor: "rgba(255, 209, 102, 0.42)",
  spiderfyNodeFill: "#ffd166",
  spiderfyNodeStroke: "#07111d",
  trailColor: "rgba(89, 215, 255, 0.55)",
  trailSelectedColor: "rgba(255, 209, 102, 0.78)",
  trailShadowColor: "rgba(7, 17, 29, 0.22)",
};

export const LABEL_MODE_VALUES = ["selected-and-hovered-only", "high-zoom-visible", "off"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizeColorLayer(color, opacity) {
  if (typeof color !== "string") {
    return color;
  }

  if (!isFiniteNumber(opacity) || opacity >= 1) {
    return color;
  }

  return color;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function resizeCanvasForViewport(canvasEl, ctx, viewportRect, devicePixelRatio = 1) {
  if (!canvasEl || !ctx || !viewportRect) {
    return {
      pixelHeight: 0,
      pixelWidth: 0,
      resized: false,
      width: 0,
      height: 0,
    };
  }

  const width = Math.max(1, Math.round(viewportRect.width));
  const height = Math.max(1, Math.round(viewportRect.height));
  const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(height * devicePixelRatio));
  let resized = false;

  canvasEl.style.left = `${Math.round(viewportRect.left)}px`;
  canvasEl.style.top = `${Math.round(viewportRect.top)}px`;
  canvasEl.style.width = `${width}px`;
  canvasEl.style.height = `${height}px`;

  if (canvasEl.width !== pixelWidth || canvasEl.height !== pixelHeight) {
    canvasEl.width = pixelWidth;
    canvasEl.height = pixelHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    resized = true;
  }

  return {
    pixelHeight,
    pixelWidth,
    resized,
    width,
    height,
  };
}

export function clearCanvas(ctx, width, height) {
  if (!ctx || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
}

export function measureTextBubble(ctx, text, options = {}) {
  const fontSize = options.fontSize ?? 12;
  const fontFamily = options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif';
  const lineHeight = options.lineHeight ?? 1.35;
  const paddingX = options.paddingX ?? 10;
  const paddingY = options.paddingY ?? 7;
  const lines = String(text ?? "").split("\n");

  if (!ctx) {
    const width = Math.max(1, String(text ?? "").length * fontSize * 0.5 + paddingX * 2);
    const height = lines.length * fontSize * lineHeight + paddingY * 2;
    return {
      height,
      lineHeight,
      lines,
      paddingX,
      paddingY,
      width,
    };
  }

  const previousFont = ctx.font;
  ctx.font = `${fontSize}px ${fontFamily}`;

  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  }

  ctx.font = previousFont;

  return {
    height: lines.length * fontSize * lineHeight + paddingY * 2,
    lineHeight,
    lines,
    paddingX,
    paddingY,
    width: maxWidth + paddingX * 2,
  };
}

export function shouldRenderAircraftLabel(aircraftId, context = {}) {
  const mode = context.mode || "off";
  const normalizedAircraftId = aircraftId === undefined || aircraftId === null ? null : String(aircraftId);
  const normalizedSelectedId =
    context.selectedAircraftId === undefined || context.selectedAircraftId === null
      ? null
      : String(context.selectedAircraftId);
  const normalizedHoveredId =
    context.hoveredAircraftId === undefined || context.hoveredAircraftId === null
      ? null
      : String(context.hoveredAircraftId);
  const minZoomForLabels = context.minZoomForLabels ?? 11;
  const zoom = isFiniteNumber(context.zoom) ? context.zoom : null;

  switch (mode) {
    case "off":
      return false;
    case "high-zoom-visible":
      return zoom !== null && zoom >= minZoomForLabels && Boolean(context.isVisible ?? true);
    case "selected-and-hovered-only":
    default:
      return (
        (normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId) ||
        (normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId)
      );
  }
}

export function drawTrail(ctx, points, options = {}) {
  if (!ctx || !Array.isArray(points) || points.length === 0) {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const lineWidth = options.lineWidth ?? 2;
  const color = options.color ?? theme.trailColor;
  const selected = Boolean(options.selected);
  const opacity = isFiniteNumber(options.opacity) ? clamp(options.opacity, 0, 1) : 1;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = selected ? theme.trailSelectedColor : normalizeColorLayer(color, opacity);
  ctx.shadowBlur = options.shadowBlur ?? 8;
  ctx.shadowColor = theme.trailShadowColor;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.stroke();

  const pointRadius = options.pointRadius ?? 2.25;
  ctx.shadowBlur = 0;
  ctx.fillStyle = selected ? theme.markerSelectedColor : color;

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  return {
    end: points[points.length - 1],
    start: points[0],
  };
}

export function drawAircraftMarker(ctx, marker, options = {}) {
  if (!ctx || !marker) {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const size = options.sizePx ?? marker.sizePx ?? 10;
  const heading = isFiniteNumber(marker.heading)
    ? marker.heading
    : marker.aircraft && isFiniteNumber(marker.aircraft.heading)
      ? marker.aircraft.heading
      : null;
  const highlighted = Boolean(options.highlighted ?? marker.highlighted);
  const selected = Boolean(options.selected ?? marker.selected);
  const faded = Boolean(options.faded ?? marker.faded);
  const opacity = faded ? (options.opacity ?? 0.48) : options.opacity ?? 1;
  const fillColor = selected
    ? theme.markerSelectedColor
    : highlighted
      ? theme.markerHighlightColor
      : options.fillColor ?? theme.markerColor;
  const strokeColor = options.strokeColor ?? theme.markerStrokeColor;

  ctx.save();
  ctx.translate(marker.x, marker.y);
  ctx.globalAlpha = clamp(opacity, 0, 1);
  ctx.shadowBlur = options.shadowBlur ?? 10;
  ctx.shadowColor = theme.markerShadowColor;

  if (highlighted || selected) {
    ctx.beginPath();
    ctx.arc(0, 0, size + (selected ? 6 : 4), 0, Math.PI * 2);
    ctx.fillStyle = selected ? "rgba(158, 243, 255, 0.18)" : "rgba(255, 209, 102, 0.18)";
    ctx.fill();
  }

  if (isFiniteNumber(heading)) {
    ctx.rotate((((heading % 360) + 360) % 360) * (Math.PI / 180));
  }

  ctx.lineWidth = selected ? 2.25 : highlighted ? 2 : 1.5;
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;

  if (isFiniteNumber(heading)) {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.65, size * 0.82);
    ctx.lineTo(0, size * 0.3);
    ctx.lineTo(-size * 0.65, size * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();

  return {
    height: size * 2,
    radius: size + (selected ? 6 : highlighted ? 4 : 0),
    width: size * 2,
    x: marker.x,
    y: marker.y,
  };
}

export function drawAircraftLabel(ctx, text, anchor, options = {}) {
  if (!ctx || !anchor || text === undefined || text === null || String(text) === "") {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const metrics = measureTextBubble(ctx, text, options);
  const offsetX = options.offsetX ?? 12;
  const offsetY = options.offsetY ?? -10;
  const fontSize = options.fontSize ?? 12;
  const x = anchor.x + offsetX;
  const y = anchor.y + offsetY - metrics.height + (options.anchor === "below" ? metrics.height : 0);
  const width = metrics.width;
  const height = metrics.height;
  const radius = options.radius ?? 10;
  const opacity = isFiniteNumber(options.opacity) ? clamp(options.opacity, 0, 1) : 1;
  const align = options.align ?? "left";

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `${fontSize}px ${options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif'}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = align === "right" ? "right" : "left";

  const boxX = align === "right" ? x - width : x;
  const boxY = y;

  roundRectPath(ctx, boxX, boxY, width, height, radius);
  ctx.fillStyle = options.fillStyle ?? theme.labelFill;
  ctx.fill();
  ctx.lineWidth = options.lineWidth ?? 1;
  ctx.strokeStyle = options.strokeStyle ?? theme.labelStroke;
  ctx.stroke();

  ctx.fillStyle = options.textColor ?? theme.labelText;

  const lines = String(text).split("\n");
  const paddingX = metrics.paddingX;
  const paddingY = metrics.paddingY;
  const lineHeight = options.lineHeight ?? metrics.lineHeight;
  const startY = boxY + paddingY + fontSize / 2;
  const textX = align === "right" ? boxX + width - paddingX : boxX + paddingX;

  for (let index = 0; index < lines.length; index += 1) {
    const lineY = startY + index * fontSize * lineHeight;
    ctx.fillText(lines[index], textX, lineY);
  }

  ctx.restore();

  return {
    height,
    width,
    x: boxX,
    y: boxY,
  };
}

export function drawClusterBubble(ctx, cluster, options = {}) {
  if (!ctx || !cluster) {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const count = Math.max(1, Math.round(cluster.count ?? 1));
  const radius = options.radiusPx ?? cluster.radiusPx ?? clamp(12 + Math.log10(count + 1) * 10, 12, 28);
  const highlighted = Boolean(options.highlighted ?? cluster.highlighted);
  const selected = Boolean(options.selected ?? cluster.selected);
  const opacity = isFiniteNumber(options.opacity) ? clamp(options.opacity, 0, 1) : 1;

  ctx.save();
  ctx.translate(cluster.x, cluster.y);
  ctx.globalAlpha = opacity;
  ctx.shadowBlur = options.shadowBlur ?? 10;
  ctx.shadowColor = theme.clusterShadow;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.fillStyle ?? theme.clusterFill;
  ctx.fill();
  ctx.lineWidth = selected ? 2.5 : highlighted ? 2 : 1.5;
  ctx.strokeStyle = options.strokeStyle ?? theme.clusterStroke;
  ctx.stroke();

  const label = options.label ?? String(cluster.label ?? count);
  ctx.shadowBlur = 0;
  ctx.fillStyle = options.textColor ?? theme.clusterStroke;
  ctx.font = `${options.fontSize ?? 12}px ${options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif'}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 1);
  ctx.restore();

  return {
    count,
    radius,
    x: cluster.x,
    y: cluster.y,
  };
}

export function drawSpiderfyConnector(ctx, centerX, centerY, memberX, memberY, options = {}) {
  if (!ctx) {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const opacity = isFiniteNumber(options.opacity) ? clamp(options.opacity, 0, 1) : 1;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(memberX, memberY);
  ctx.lineWidth = options.lineWidth ?? 1.5;
  ctx.strokeStyle = options.strokeStyle ?? theme.spiderfyLineColor;
  ctx.stroke();
  ctx.restore();

  return {
    centerX,
    centerY,
    memberX,
    memberY,
  };
}

export function drawSpiderfyLayout(ctx, spiderfy, options = {}) {
  if (!ctx || !spiderfy || !Array.isArray(spiderfy.members) || spiderfy.members.length === 0) {
    return null;
  }

  const theme = { ...DEFAULT_CANVAS_THEME, ...(options.theme || {}) };
  const centerX = spiderfy.centerX;
  const centerY = spiderfy.centerY;
  const memberRadiusPx = options.memberRadiusPx ?? spiderfy.memberRadiusPx ?? 7;
  const members = [];

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const member of spiderfy.members) {
    drawSpiderfyConnector(ctx, centerX, centerY, member.x, member.y, {
      ...options,
      strokeStyle: options.connectorColor ?? theme.spiderfyLineColor,
    });
    members.push(
      drawAircraftMarker(
        ctx,
        {
          highlighted: member.highlighted,
          heading: member.heading,
          selected: member.selected,
          x: member.x,
          y: member.y,
        },
        {
          ...options,
          opacity: member.opacity,
          sizePx: memberRadiusPx,
          theme,
        }
      )
    );

    if (member.label) {
      drawAircraftLabel(
        ctx,
        member.label,
        {
          x: member.x,
          y: member.y,
        },
        {
          ...options,
          align: "left",
          offsetX: 10,
          offsetY: -10,
          theme,
        }
      );
    }
  }

  drawClusterBubble(
    ctx,
    {
      count: spiderfy.members.length,
      x: centerX,
      y: centerY,
    },
    {
      ...options,
      fillStyle: options.centerFillStyle ?? "rgba(255, 209, 102, 0.18)",
      strokeStyle: options.centerStrokeStyle ?? theme.spiderfyLineColor,
      textColor: options.centerTextColor ?? theme.labelText,
      radiusPx: options.centerRadiusPx ?? 8,
    }
  );

  ctx.restore();

  return {
    centerX,
    centerY,
    members,
  };
}
