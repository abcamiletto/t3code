import { Platform } from "react-native";
import Svg, { Text, TSpan } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedText = withUniwind(Text);

export function ProjectLatexGlyph({ size }: { readonly size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 20" accessibilityLabel="TeX">
      <ThemedText
        colorClassName="text-foreground"
        fill="currentColor"
        fontFamily={Platform.select({ ios: "Georgia", default: "serif" })}
        fontSize="15"
        fontWeight="700"
        textAnchor="middle"
      >
        <TSpan x="4.5" y="13">
          T
        </TSpan>
        <TSpan x="11.5" y="16">
          E
        </TSpan>
        <TSpan x="19" y="13">
          X
        </TSpan>
      </ThemedText>
    </Svg>
  );
}
