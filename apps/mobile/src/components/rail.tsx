import { spacing } from "@katha/tokens";
import { FlashList } from "@shopify/flash-list";
import { StyleSheet, View } from "react-native";
import { CARD_WIDTH, SeriesCard } from "@/components/series-card";
import { SectionHeader } from "@/components/ui";
import type { SeriesCard as SeriesCardModel } from "@/lib/types";

export function Rail({ title, items, right }: { title: string; items: SeriesCardModel[]; right?: React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} right={right} />
      <FlashList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SeriesCard series={item} width={CARD_WIDTH} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Separator}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ width: spacing.md }} />;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: spacing.lg } });
