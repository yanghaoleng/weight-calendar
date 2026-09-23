import { createContext, useContext } from "react";
import * as Iconoir from "iconoir-react";

// 图标粗细档位（与 Phosphor 的 weight 语义对应，换成 iconoir 的 strokeWidth）：
//   regular -> 2   bold -> 3   thin -> 1.5   light -> 1.75
export const IconContext = createContext({ strokeWidth: 2 });

function withWeight(Component) {
  return function WeightedIcon(props) {
    const { strokeWidth: contextStroke } = useContext(IconContext);
    const { size, weight, strokeWidth, ...rest } = props;
    const resolvedStrokeWidth = strokeWidth
      ?? (weight === "bold" ? 3
        : weight === "thin" ? 1.5
          : weight === "light" ? 1.75
            : weight === "regular" ? 2
              : contextStroke);
    const sizeValue = size ?? 20;
    return (
      <Component
        width={sizeValue}
        height={sizeValue}
        strokeWidth={resolvedStrokeWidth}
        {...rest}
      />
    );
  };
}

export const Backspace = withWeight(Iconoir.Erase);
export const ArrowsLeftRight = withWeight(Iconoir.Repeat);
export const ArrowLeft = withWeight(Iconoir.ArrowLeft);
export const ArrowRight = withWeight(Iconoir.ArrowRight);
export const ChartLineUp = withWeight(Iconoir.GraphUp);
export const Cloud = withWeight(Iconoir.Cloud);
export const CaretDown = withWeight(Iconoir.NavArrowDown);
export const CaretLeft = withWeight(Iconoir.NavArrowLeft);
export const CaretRight = withWeight(Iconoir.NavArrowRight);
export const CaretUp = withWeight(Iconoir.NavArrowUp);
export const Check = withWeight(Iconoir.Check);
export const DownloadSimple = withWeight(Iconoir.Download);
export const ForkKnife = withWeight(Iconoir.OrganicFood);
export const GearSix = withWeight(Iconoir.Settings);
export const Gauge = withWeight(Iconoir.Weight);
export const Heart = withWeight(Iconoir.Heart);
export const ImageSquare = withWeight(Iconoir.MediaImage);
export const LockKey = withWeight(Iconoir.Lock);
export const MoonStars = withWeight(Iconoir.HalfMoon);
export const PersonSimpleRun = withWeight(Iconoir.Running);
export const Sparkle = withWeight(Iconoir.MagicWand);
export const SpeakerHigh = withWeight(Iconoir.SoundHigh);
export const SpeakerSlash = withWeight(Iconoir.SoundOff);
export const SignOut = withWeight(Iconoir.LogOut);
export const ShieldCheck = withWeight(Iconoir.ShieldCheck);
export const Trash = withWeight(Iconoir.Trash);
export const Translate = withWeight(Iconoir.Translate);
export const UploadSimple = withWeight(Iconoir.Upload);
export const Users = withWeight(Iconoir.Group);
export const Warning = withWeight(Iconoir.WarningTriangle);
export const WechatLogo = withWeight(Iconoir.ChatBubble);
export const X = withWeight(Iconoir.X);
