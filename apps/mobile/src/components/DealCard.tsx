import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Deal, CommunityScore } from '../../types';

interface DealCardProps {
  deal: Deal;
  onPress: (deal: Deal) => void;
  onVote?: (dealId: string, vote: 'up' | 'down') => void;
  userVote?: 'up' | 'down';
  style?: any;
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
  onPress,
  onVote,
  userVote,
  style,
}) => {
  const theme = useTheme();

  const formatDiscount = () => {
    if (deal.discount.type === 'percentage') {
      return `${deal.discount.value}% OFF`;
    } else if (deal.discount.type === 'fixed') {
      return `¥${deal.discount.value.toLocaleString()} OFF`;
    } else if (deal.discount.type === 'buy_one_get_one') {
      return 'BOGO';
    }
    return 'SALE';
  };

  const getDealTypeColor = () => {
    switch (deal.type) {
      case 'limited_time':
        return theme.colors.error[500];
      case 'clearance':
        return theme.colors.warning[500];
      case 'coupon':
        return theme.colors.primary[500];
      default:
        return theme.colors.success[500];
    }
  };

  const getDealTypeLabel = () => {
    switch (deal.type) {
      case 'limited_time':
        return 'LIMITED TIME';
      case 'clearance':
        return 'CLEARANCE';
      case 'coupon':
        return 'COUPON';
      case 'bundle':
        return 'BUNDLE';
      case 'sale':
        return 'SALE';
      default:
        return 'DEAL';
    }
  };

  const isExpired = deal.endDate && new Date(deal.endDate) < new Date();

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme.colors.card }, style]}
      onPress={() => onPress(deal)}
      disabled={isExpired}
    >
      {/* Deal Image */}
      {deal.images && deal.images.length > 0 && (
        <Image
          source={{ uri: deal.images[0].url }}
          style={styles.image}
          resizeMode="cover"
        />
      )}

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <Text
              style={[
                styles.title,
                { color: theme.colors.text.primary },
                isExpired && styles.expiredText,
              ]}
              numberOfLines={2}
            >
              {deal.title}
            </Text>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: getDealTypeColor() },
              ]}
            >
              <Text style={[styles.typeText, { color: theme.colors.white }]}>
                {getDealTypeLabel()}
              </Text>
            </View>
          </View>
          {isExpired && (
            <View style={[styles.expiredBadge, { backgroundColor: theme.colors.gray[300] }]}>
              <Text style={[styles.expiredText, { color: theme.colors.text.secondary }]}>
                EXPIRED
              </Text>
            </View>
          )}
        </View>

        {/* Description */}
        {deal.description && (
          <Text
            style={[styles.description, { color: theme.colors.text.secondary }]}
            numberOfLines={2}
          >
            {deal.description}
          </Text>
        )}

        {/* Discount Display */}
        <View style={styles.discountContainer}>
          <Text style={[styles.discountText, { color: getDealTypeColor() }]}>
            {formatDiscount()}
          </Text>
          {deal.products && deal.products.length > 0 && (
            <Text style={[styles.productsText, { color: theme.colors.text.secondary }]}>
              {deal.products.length} product{deal.products.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>

        {/* Platforms */}
        {deal.platforms && deal.platforms.length > 0 && (
          <View style={styles.platformsContainer}>
            <Text style={[styles.platformsLabel, { color: theme.colors.text.secondary }]}>
              Available at:
            </Text>
            <Text style={[styles.platformsText, { color: theme.colors.primary[500] }]}>
              {deal.platforms.join(', ')}
            </Text>
          </View>
        )}

        {/* Time */}
        <View style={styles.timeContainer}>
          <Ionicons
            name="time-outline"
            size={14}
            color={theme.colors.text.secondary}
          />
          <Text style={[styles.timeText, { color: theme.colors.text.secondary }]}>
            {deal.startDate && `Starts ${new Date(deal.startDate).toLocaleDateString()}`}
            {deal.startDate && deal.endDate && ' • '}
            {deal.endDate && `Ends ${new Date(deal.endDate).toLocaleDateString()}`}
          </Text>
        </View>

        {/* Footer with voting */}
        <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
          <View style={styles.votingContainer}>
            <TouchableOpacity
              style={[
                styles.voteButton,
                userVote === 'up' && { backgroundColor: theme.colors.primary[100] },
              ]}
              onPress={() => onVote?.(deal.id, 'up')}
            >
              <Ionicons
                name="thumbs-up"
                size={16}
                color={userVote === 'up' ? theme.colors.primary[500] : theme.colors.gray[400]}
              />
              <Text
                style={[
                  styles.voteCount,
                  { color: userVote === 'up' ? theme.colors.primary[500] : theme.colors.text.secondary },
                ]}
              >
                {deal.communityScore.upvotes}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.voteButton,
                userVote === 'down' && { backgroundColor: theme.colors.error[100] },
              ]}
              onPress={() => onVote?.(deal.id, 'down')}
            >
              <Ionicons
                name="thumbs-down"
                size={16}
                color={userVote === 'down' ? theme.colors.error[500] : theme.colors.gray[400]}
              />
              <Text
                style={[
                  styles.voteCount,
                  { color: userVote === 'down' ? theme.colors.error[500] : theme.colors.text.secondary },
                ]}
              >
                {deal.communityScore.downvotes}
              </Text>
            </TouchableOpacity>
          </View>

          {deal.communityScore.totalScore > 0 && (
            <View style={styles.scoreContainer}>
              <Text style={[styles.scoreText, { color: theme.colors.success[500] }]}>
                {Math.round((deal.communityScore.totalScore / (deal.communityScore.upvotes + deal.communityScore.downvotes)) * 100)}% worth it
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  image: {
    width: '100%',
    height: 160,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 6,
  },
  expiredText: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  typeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  expiredBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  discountContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  discountText: {
    fontSize: 18,
    fontWeight: '700',
  },
  productsText: {
    fontSize: 12,
  },
  platformsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  platformsLabel: {
    fontSize: 12,
    marginRight: 4,
  },
  platformsText: {
    fontSize: 12,
    fontWeight: '500',
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeText: {
    fontSize: 12,
    marginLeft: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  votingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 12,
  },
  voteCount: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  scoreContainer: {
    alignSelf: 'flex-end',
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default DealCard;