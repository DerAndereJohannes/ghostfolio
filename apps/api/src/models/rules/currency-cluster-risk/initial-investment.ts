import { RuleSettings } from '@ghostfolio/api/models/interfaces/rule-settings.interface';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { TimelinePosition, UserSettings } from '@ghostfolio/common/interfaces';

import { Rule } from '../../rule';

export class CurrencyClusterRiskInitialInvestment extends Rule<Settings> {
  public constructor(
    protected exchangeRateDataService: ExchangeRateDataService,
    private positions: TimelinePosition[]
  ) {
    super(exchangeRateDataService, {
      name: 'Initial Investment'
    });
  }

  public evaluate(ruleSettings: Settings) {
    const positionsGroupedByCurrency = this.groupCurrentPositionsByAttribute(
      this.positions,
      'currency',
      ruleSettings.baseCurrency
    );

    let maxItem = positionsGroupedByCurrency[0];
    let totalInvestment = 0;

    positionsGroupedByCurrency.forEach((groupItem) => {
      // Calculate total investment
      totalInvestment += groupItem.investment;

      // Find maximum
      if (groupItem.investment > maxItem.investment) {
        maxItem = groupItem;
      }
    });

    const maxInvestmentRatio = maxItem.investment / totalInvestment;

    if (maxInvestmentRatio > ruleSettings.threshold) {
      return {
        evaluation: `Over ${
          ruleSettings.threshold * 100
        }% of your initial investment is in ${maxItem.groupKey} (${(
          maxInvestmentRatio * 100
        ).toPrecision(3)}%)`,
        value: false
      };
    }

    return {
      evaluation: `The major part of your initial investment is in ${
        maxItem.groupKey
      } (${(maxInvestmentRatio * 100).toPrecision(3)}%) and does not exceed ${
        ruleSettings.threshold * 100
      }%`,
      value: true
    };
  }

  public getSettings(aUserSettings: UserSettings): Settings {
    return {
      baseCurrency: aUserSettings.baseCurrency,
      isActive: true,
      threshold: 0.5
    };
  }
}

interface Settings extends RuleSettings {
  baseCurrency: string;
  threshold: number;
}
