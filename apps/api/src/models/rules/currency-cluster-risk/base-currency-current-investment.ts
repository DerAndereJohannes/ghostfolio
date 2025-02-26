import { RuleSettings } from '@ghostfolio/api/models/interfaces/rule-settings.interface';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { TimelinePosition, UserSettings } from '@ghostfolio/common/interfaces';

import { Rule } from '../../rule';

export class CurrencyClusterRiskBaseCurrencyCurrentInvestment extends Rule<Settings> {
  public constructor(
    protected exchangeRateDataService: ExchangeRateDataService,
    private positions: TimelinePosition[]
  ) {
    super(exchangeRateDataService, {
      name: 'Current Investment: Base Currency'
    });
  }

  public evaluate(ruleSettings: Settings) {
    const positionsGroupedByCurrency = this.groupCurrentPositionsByAttribute(
      this.positions,
      'currency',
      ruleSettings.baseCurrency
    );

    let maxItem = positionsGroupedByCurrency[0];
    let totalValue = 0;

    positionsGroupedByCurrency.forEach((groupItem) => {
      // Calculate total value
      totalValue += groupItem.value;

      // Find maximum
      if (groupItem.investment > maxItem.investment) {
        maxItem = groupItem;
      }
    });

    const baseCurrencyItem = positionsGroupedByCurrency.find((item) => {
      return item.groupKey === ruleSettings.baseCurrency;
    });

    const baseCurrencyValueRatio = baseCurrencyItem?.value / totalValue || 0;

    if (maxItem.groupKey !== ruleSettings.baseCurrency) {
      return {
        evaluation: `The major part of your current investment is not in your base currency (${(
          baseCurrencyValueRatio * 100
        ).toPrecision(3)}% in ${ruleSettings.baseCurrency})`,
        value: false
      };
    }

    return {
      evaluation: `The major part of your current investment is in your base currency (${(
        baseCurrencyValueRatio * 100
      ).toPrecision(3)}% in ${ruleSettings.baseCurrency})`,
      value: true
    };
  }

  public getSettings(aUserSettings: UserSettings): Settings {
    return {
      baseCurrency: aUserSettings.baseCurrency,
      isActive: true
    };
  }
}

interface Settings extends RuleSettings {
  baseCurrency: string;
}
