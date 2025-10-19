import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  LineChart,
} from 'react-native-chart-kit';
import { useTheme } from '../../theme';
import { PriceHistory, PriceStatistics } from '../../types';

interface PriceChartProps {
  data: PriceHistory[];
  statistics?: PriceStatistics;
  height?: number;
  showLegend?: boolean;
  showDots?: boolean;
  width?: number;
}

const { width: screenWidth } = Dimensions.get('window');

export const PriceChart: React.FC<PriceChartProps> = ({
  data,
  statistics,
  height = 220,
  showLegend = true,
  showDots = true,
  width = screenWidth - 32, // Account for padding
}) => {
  const theme = useTheme();

  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        labels: ['No Data'],
        datasets: [{
          data: [0],
          color: () => theme.colors.primary[500],
          strokeWidth: 2,
        }],
      };
    }

    // Sort data by date
    const sortedData = [...data].sort((a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    // Group data by date and take the latest price per day
    const dailyData = new Map<string, number>();
    sortedData.forEach(item => {
      const date = new Date(item.recordedAt).toLocaleDateString();
      dailyData.set(date, item.price);
    });

    const labels = Array.from(dailyData.keys()).slice(-30); // Last 30 days
    const prices = labels.map(date => dailyData.get(date) || 0);

    return {
      labels,
      datasets: [{
        data: prices,
        color: () => theme.colors.primary[500],
        strokeWidth: 2,
      }],
    };
  }, [data, theme.colors.primary[500]]);

  const formatPrice = (value: number) => {
    return `¥${Math.round(value).toLocaleString()}`;
  };

  const chartConfig = {
    backgroundColor: theme.colors.card,
    backgroundGradientFrom: theme.colors.card,
    backgroundGradientTo: theme.colors.card,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    style: {
      borderRadius: 16,
    },
    propsForDots: showDots ? {
      r: '3',
      strokeWidth: '1',
      stroke: theme.colors.primary[500],
    } : {
      r: '0',
    },
    propsForLabels: {
      fontSize: 10,
      fontWeight: '500',
    },
  };

  const renderDotContent = (value: number) => {
    return null; // We'll handle dots with chartConfig
  };

  if (!data || data.length === 0) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.colors.card }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: theme.colors.text.secondary }]}>
            No price history available
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.card }]}>
      {statistics && (
        <View style={styles.statisticsContainer}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>
              Current
            </Text>
            <Text style={[styles.statValue, { color: theme.colors.text.primary }]}>
              {formatPrice(statistics.currentPrice)}
            </Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>
              Average
            </Text>
            <Text style={[styles.statValue, { color: theme.colors.text.primary }]}>
              {formatPrice(statistics.averagePrice)}
            </Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>
              Lowest
            </Text>
            <Text style={[styles.statValue, { color: theme.colors.success[500] }]}>
              {formatPrice(statistics.lowestPrice)}
            </Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.text.secondary }]}>
              Change
            </Text>
            <Text
              style={[
                styles.statValue,
                {
                  color: statistics.priceChangePercent >= 0
                    ? theme.colors.success[500]
                    : theme.colors.error[500],
                },
              ]}
            >
              {statistics.priceChangePercent >= 0 ? '+' : ''}
              {statistics.priceChangePercent.toFixed(1)}%
            </Text>
          </View>
        </View>
      )}

      <LineChart
        data={chartData}
        width={width}
        height={height}
        chartConfig={chartConfig}
        bezier
        style={styles.chart}
        withInnerLines={false}
        withOuterLines={true}
        withVerticalLines={false}
        withHorizontalLines={true}
        segments={4}
        formatYLabel={formatPrice}
        renderDotContent={renderDotContent}
      />

      {showLegend && (
        <View style={styles.legendContainer}>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: theme.colors.primary[500] },
              ]}
            />
            <Text style={[styles.legendText, { color: theme.colors.text.secondary }]}>
              Price History
            </Text>
          </View>

          {statistics && (
            <View style={styles.legendItem}>
              <Text style={[styles.legendText, { color: theme.colors.text.secondary }]}>
                {statistics.trend === 'rising' && '↗ Rising'}
                {statistics.trend === 'falling' && '↘ Falling'}
                {statistics.trend === 'stable' && '→ Stable'}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statisticsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 200,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default PriceChart;