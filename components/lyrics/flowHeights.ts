import { ILyricLine } from "./ILyricLine";

export const flowHeightsOf = (
  lines: ILyricLine[],
  currentTime: number,
  currentHeights: number[],
) => {
  return lines.map((line, index) => {
    if (line.isInterlude()) {
      return currentHeights[index] ?? 0;
    }
    return line.getTargetHeight(currentTime);
  });
};
