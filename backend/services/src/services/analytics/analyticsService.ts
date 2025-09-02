import { logger } from '../../../../utils/src/logger';

export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp?: Date;
}

export class AnalyticsService {
  private enabled: boolean;

  constructor() {
    // Check if analytics is enabled via environment variable (like Rust version)
    this.enabled = !!process.env.POSTHOG_API_KEY;
  }

  async trackEvent(event: string, properties?: Record<string, any>): Promise<void> {
    if (!this.enabled) {
      logger.debug(`Analytics disabled - would track: ${event}`);
      return;
    }

    try {
      // For now, just log the event. In full implementation, would send to PostHog
      logger.info('Analytics event tracked', {
        event,
        properties,
        timestamp: new Date().toISOString()
      });

      // TODO: Implement actual PostHog integration
      // await this.sendToPostHog(event, properties);
    } catch (error) {
      logger.warn('Failed to track analytics event:', error);
    }
  }

  async identifyUser(userId: string, properties: Record<string, any>): Promise<void> {
    await this.trackEvent('$identify', {
      distinct_id: userId,
      ...properties
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Private method for future PostHog integration
  private async sendToPostHog(event: string, properties?: Record<string, any>): Promise<void> {
    const apiKey = process.env.POSTHOG_API_KEY;
    if (!apiKey) {
      return;
    }

    // TODO: Implement PostHog HTTP API call
    // const payload = {
    //   api_key: apiKey,
    //   event,
    //   properties: {
    //     ...properties,
    //     timestamp: new Date().toISOString()
    //   }
    // };
    
    logger.debug('PostHog integration not yet implemented');
  }
}

// Singleton instance
export const analyticsService = new AnalyticsService();
