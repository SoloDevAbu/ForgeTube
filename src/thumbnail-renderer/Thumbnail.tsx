import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import type { ThumbnailLayout, ThumbnailLook, ThumbnailRenderProps, ThumbnailRenderVariant } from "../core/schemas/publish";

const GRADES: Record<ThumbnailLook, string> = {
  dark: "contrast(1.22) saturate(1.18) brightness(0.9)",
  warm: "contrast(1.18) saturate(1.25) sepia(0.22) brightness(0.92)",
  cold: "contrast(1.22) saturate(0.85) hue-rotate(-8deg) brightness(0.88)",
  none: "none",
};

/** Darkens the side the text sits on, so it reads over any image. */
const SCRIMS: Record<ThumbnailLayout, string> = {
  left: "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 34%, rgba(0,0,0,0) 66%)",
  right: "linear-gradient(270deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 34%, rgba(0,0,0,0) 66%)",
  bottom: "linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 30%, rgba(0,0,0,0) 62%)",
  center: "radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.12) 100%)",
};

const VIGNETTE = "radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,0.5) 100%)";
const MARGIN = 56;

const TEXT_POSITION: Record<ThumbnailLayout, React.CSSProperties> = {
  left: { left: MARGIN, top: "50%", transform: "translateY(-50%)", textAlign: "left" },
  right: { right: MARGIN, top: "50%", transform: "translateY(-50%)", textAlign: "right" },
  bottom: { left: MARGIN, bottom: 44, textAlign: "left" },
  center: { left: "50%", top: "50%", transform: "translate(-50%, -50%)", textAlign: "center" },
};

const Picture: React.FC<{ variant: ThumbnailRenderVariant }> = ({ variant }) => {
  const { crop, scale, translate } = variant;
  const src = staticFile(variant.src);
  return (
    <AbsoluteFill style={{ overflow: "hidden", filter: GRADES[variant.look] }}>
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          transformOrigin: "0 0",
          transform: `translate(${translate.x * 100}%, ${translate.y * 100}%) scale(${scale})`,
        }}
      >
        {crop ? (
          <Img
            src={src}
            alt=""
            style={{
              position: "absolute",
              width: `${(1 / crop.width) * 100}%`,
              height: `${(1 / crop.height) * 100}%`,
              left: `-${(crop.x / crop.width) * 100}%`,
              top: `-${(crop.y / crop.height) * 100}%`,
              maxWidth: "none",
            }}
          />
        ) : (
          <Img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
    </AbsoluteFill>
  );
};

const Thumbnail: React.FC<{ variant: ThumbnailRenderVariant }> = ({ variant }) => {
  const size = variant.fontSize;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Picture variant={variant} />
      <AbsoluteFill style={{ background: VIGNETTE }} />
      {variant.lines.length > 0 && <AbsoluteFill style={{ background: SCRIMS[variant.layout] }} />}
      {variant.lines.length > 0 && (
        <div
          style={{
            position: "absolute",
            ...TEXT_POSITION[variant.layout],
            fontFamily: variant.fontFamily,
            fontWeight: variant.fontWeight,
            fontSize: size,
            lineHeight: variant.lineHeight,
            textTransform: variant.uppercase ? "uppercase" : "none",
            whiteSpace: "nowrap",
            color: "#FFFFFF",
            WebkitTextStroke: `${Math.round(size * 0.075)}px #000000`,
            paintOrder: "stroke fill",
            textShadow: `0 ${Math.round(size * 0.04)}px ${Math.round(size * 0.12)}px rgba(0,0,0,0.85)`,
          }}
        >
          {variant.lines.map((line, i) => (
            <div key={i}>
              {line.map((run, n) => (
                <span key={n} style={{ color: run.accent ? variant.accent : "#FFFFFF" }}>
                  {n > 0 ? " " : ""}
                  {run.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Thumbnails: React.FC<ThumbnailRenderProps> = ({ variants }) => {
  const variant = variants[useCurrentFrame()];
  return variant ? <Thumbnail variant={variant} /> : <AbsoluteFill style={{ backgroundColor: "#000000" }} />;
};
