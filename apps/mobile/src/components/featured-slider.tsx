import { colors, radii, spacing } from "@katha/tokens";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Pill, Text } from "@/components/ui";
import type { SeriesCard } from "@/lib/types";

/** 16:9 hero slider for the `featured` rail. Uses banner_url and falls back to cover_url. */
export function FeaturedSlider({ items }: { items: SeriesCard[] }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const slideWidth = width - spacing.lg * 2;
  const slideHeight = Math.round((slideWidth * 9) / 16);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<SeriesCard>>(null);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / (slideWidth + spacing.md));
      setIndex(Math.max(0, Math.min(items.length - 1, i)));
    },
    [items.length, slideWidth],
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={slideWidth + spacing.md}
        decelerationRate="fast"
        onMomentumScrollEnd={onScrollEnd}
        contentContainerStyle={{ paddingHorizontal: spacing.lg }}
        ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: "/series/[id]", params: { id: item.id } })}
            style={({ pressed }) => [styles.slide, { width: slideWidth, height: slideHeight, opacity: pressed ? 0.9 : 1 }]}
          >
            <Image source={item.banner_url ?? item.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            <View style={styles.scrim} />
            <View style={styles.caption}>
              {item.is_premium ? <Pill label="VIP" tone="gold" /> : null}
              <Text variant="title" numberOfLines={1}>
                {item.title}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {item.episode_count} episodes{item.categories[0] ? ` · ${item.categories[0].name}` : ""}
              </Text>
            </View>
          </Pressable>
        )}
      />
      {items.length > 1 ? (
        <View style={styles.dots}>
          {items.map((it, i) => (
            <View key={it.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  slide: { borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(20,16,19,0.35)" },
  caption: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg, gap: 2 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.accent, width: 16 },
});
