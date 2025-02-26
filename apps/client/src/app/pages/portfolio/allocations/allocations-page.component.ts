import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountDetailDialog } from '@ghostfolio/client/components/account-detail-dialog/account-detail-dialog.component';
import { AccountDetailDialogParams } from '@ghostfolio/client/components/account-detail-dialog/interfaces/interfaces';
import { PositionDetailDialogParams } from '@ghostfolio/client/components/position/position-detail-dialog/interfaces/interfaces';
import { PositionDetailDialog } from '@ghostfolio/client/components/position/position-detail-dialog/position-detail-dialog.component';
import { DataService } from '@ghostfolio/client/services/data.service';
import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { UNKNOWN_KEY } from '@ghostfolio/common/config';
import { prettifySymbol } from '@ghostfolio/common/helper';
import {
  Filter,
  PortfolioDetails,
  PortfolioPosition,
  UniqueAsset,
  User
} from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { Market } from '@ghostfolio/common/types';
import { translate } from '@ghostfolio/ui/i18n';
import { Account, AssetClass, DataSource } from '@prisma/client';
import { isNumber } from 'lodash';
import { DeviceDetectorService } from 'ngx-device-detector';
import { Subject } from 'rxjs';
import { distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';

@Component({
  host: { class: 'page' },
  selector: 'gf-allocations-page',
  styleUrls: ['./allocations-page.scss'],
  templateUrl: './allocations-page.html'
})
export class AllocationsPageComponent implements OnDestroy, OnInit {
  public accounts: {
    [id: string]: Pick<Account, 'name'> & {
      id: string;
      value: number;
    };
  };
  public activeFilters: Filter[] = [];
  public allFilters: Filter[];
  public continents: {
    [code: string]: { name: string; value: number };
  };
  public countries: {
    [code: string]: { name: string; value: number };
  };
  public deviceType: string;
  public filters$ = new Subject<Filter[]>();
  public hasImpersonationId: boolean;
  public isLoading = false;
  public markets: {
    [key in Market]: { name: string; value: number };
  };
  public placeholder = '';
  public portfolioDetails: PortfolioDetails;
  public positions: {
    [symbol: string]: Pick<
      PortfolioPosition,
      | 'assetClass'
      | 'assetSubClass'
      | 'currency'
      | 'exchange'
      | 'name'
      | 'value'
    > & { etfProvider: string };
  };
  public sectors: {
    [name: string]: { name: string; value: number };
  };
  public symbols: {
    [name: string]: {
      dataSource?: DataSource;
      name: string;
      symbol: string;
      value: number;
    };
  };

  public user: User;
  public worldMapChartFormat: string;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private deviceService: DeviceDetectorService,
    private dialog: MatDialog,
    private impersonationStorageService: ImpersonationStorageService,
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {
    route.queryParams
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((params) => {
        if (params['accountId'] && params['accountDetailDialog']) {
          this.openAccountDetailDialog(params['accountId']);
        } else if (
          params['dataSource'] &&
          params['positionDetailDialog'] &&
          params['symbol']
        ) {
          this.openPositionDialog({
            dataSource: params['dataSource'],
            symbol: params['symbol']
          });
        }
      });
  }

  public ngOnInit() {
    this.deviceType = this.deviceService.getDeviceInfo().deviceType;

    this.impersonationStorageService
      .onChangeHasImpersonation()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((impersonationId) => {
        this.hasImpersonationId = !!impersonationId;
      });

    this.filters$
      .pipe(
        distinctUntilChanged(),
        switchMap((filters) => {
          this.isLoading = true;
          this.activeFilters = filters;
          this.placeholder =
            this.activeFilters.length <= 0
              ? $localize`Filter by account or tag...`
              : '';

          return this.dataService.fetchPortfolioDetails({
            filters: this.activeFilters
          });
        }),
        takeUntil(this.unsubscribeSubject)
      )
      .subscribe((portfolioDetails) => {
        this.portfolioDetails = portfolioDetails;

        this.initializeAnalysisData();

        this.isLoading = false;

        this.changeDetectorRef.markForCheck();
      });

    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        if (state?.user) {
          this.user = state.user;

          const accountFilters: Filter[] = this.user.accounts
            .filter(({ accountType }) => {
              return accountType === 'SECURITIES';
            })
            .map(({ id, name }) => {
              return {
                id,
                label: name,
                type: 'ACCOUNT'
              };
            });

          const assetClassFilters: Filter[] = [];
          for (const assetClass of Object.keys(AssetClass)) {
            assetClassFilters.push({
              id: assetClass,
              label: translate(assetClass),
              type: 'ASSET_CLASS'
            });
          }

          const tagFilters: Filter[] = this.user.tags.map(({ id, name }) => {
            return {
              id,
              label: translate(name),
              type: 'TAG'
            };
          });

          this.allFilters = [
            ...accountFilters,
            ...assetClassFilters,
            ...tagFilters
          ];

          this.worldMapChartFormat =
            this.hasImpersonationId || this.user.settings.isRestrictedView
              ? `{0}%`
              : `{0} ${this.user?.settings?.baseCurrency}`;

          this.changeDetectorRef.markForCheck();
        }
      });

    this.initialize();
  }

  public initialize() {
    this.accounts = {};
    this.continents = {
      [UNKNOWN_KEY]: {
        name: UNKNOWN_KEY,
        value: 0
      }
    };
    this.countries = {
      [UNKNOWN_KEY]: {
        name: UNKNOWN_KEY,
        value: 0
      }
    };
    this.markets = {
      developedMarkets: {
        name: 'developedMarkets',
        value: undefined
      },
      emergingMarkets: {
        name: 'emergingMarkets',
        value: undefined
      },
      otherMarkets: {
        name: 'otherMarkets',
        value: undefined
      }
    };
    this.positions = {};
    this.sectors = {
      [UNKNOWN_KEY]: {
        name: UNKNOWN_KEY,
        value: 0
      }
    };
    this.symbols = {
      [UNKNOWN_KEY]: {
        name: UNKNOWN_KEY,
        symbol: UNKNOWN_KEY,
        value: 0
      }
    };
  }

  public initializeAnalysisData() {
    this.initialize();

    for (const [id, { current, name }] of Object.entries(
      this.portfolioDetails.accounts
    )) {
      this.accounts[id] = {
        id,
        name,
        value: current
      };
    }

    for (const [symbol, position] of Object.entries(
      this.portfolioDetails.holdings
    )) {
      let value = 0;

      if (this.hasImpersonationId) {
        value = position.allocationInPercentage;
      } else {
        value = position.value;
      }

      this.positions[symbol] = {
        value,
        assetClass: position.assetClass,
        assetSubClass: position.assetSubClass,
        currency: position.currency,
        etfProvider: this.extractEtfProvider({
          assetSubClass: position.assetSubClass,
          name: position.name
        }),
        exchange: position.exchange,
        name: position.name
      };

      if (position.assetClass !== AssetClass.CASH) {
        // Prepare analysis data by continents, countries and sectors except for cash

        if (position.countries.length > 0) {
          if (!this.markets.developedMarkets.value) {
            this.markets.developedMarkets.value = 0;
          }
          if (!this.markets.emergingMarkets.value) {
            this.markets.emergingMarkets.value = 0;
          }
          if (!this.markets.otherMarkets.value) {
            this.markets.otherMarkets.value = 0;
          }

          this.markets.developedMarkets.value +=
            position.markets.developedMarkets * position.value;
          this.markets.emergingMarkets.value +=
            position.markets.emergingMarkets * position.value;
          this.markets.otherMarkets.value +=
            position.markets.otherMarkets * position.value;

          for (const country of position.countries) {
            const { code, continent, name, weight } = country;

            if (this.continents[continent]?.value) {
              this.continents[continent].value += weight * position.value;
            } else {
              this.continents[continent] = {
                name: continent,
                value: weight * this.portfolioDetails.holdings[symbol].value
              };
            }

            if (this.countries[code]?.value) {
              this.countries[code].value += weight * position.value;
            } else {
              this.countries[code] = {
                name,
                value: weight * this.portfolioDetails.holdings[symbol].value
              };
            }
          }
        } else {
          this.continents[UNKNOWN_KEY].value +=
            this.portfolioDetails.holdings[symbol].value;

          this.countries[UNKNOWN_KEY].value +=
            this.portfolioDetails.holdings[symbol].value;
        }

        if (position.sectors.length > 0) {
          for (const sector of position.sectors) {
            const { name, weight } = sector;

            if (this.sectors[name]?.value) {
              this.sectors[name].value += weight * position.value;
            } else {
              this.sectors[name] = {
                name,
                value: weight * this.portfolioDetails.holdings[symbol].value
              };
            }
          }
        } else {
          this.sectors[UNKNOWN_KEY].value +=
            this.portfolioDetails.holdings[symbol].value;
        }
      }

      this.symbols[prettifySymbol(symbol)] = {
        dataSource: position.dataSource,
        name: position.name,
        symbol: prettifySymbol(symbol),
        value: isNumber(position.value)
          ? position.value
          : position.valueInPercentage
      };
    }

    const marketsTotal =
      this.markets.developedMarkets.value +
      this.markets.emergingMarkets.value +
      this.markets.otherMarkets.value;

    this.markets.developedMarkets.value =
      this.markets.developedMarkets.value / marketsTotal;
    this.markets.emergingMarkets.value =
      this.markets.emergingMarkets.value / marketsTotal;
    this.markets.otherMarkets.value =
      this.markets.otherMarkets.value / marketsTotal;
  }

  public onAccountChartClicked({ symbol }: UniqueAsset) {
    if (symbol && symbol !== UNKNOWN_KEY) {
      this.router.navigate([], {
        queryParams: { accountId: symbol, accountDetailDialog: true }
      });
    }
  }

  public onSymbolChartClicked({ dataSource, symbol }: UniqueAsset) {
    if (dataSource && symbol) {
      this.router.navigate([], {
        queryParams: { dataSource, symbol, positionDetailDialog: true }
      });
    }
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private openAccountDetailDialog(aAccountId: string) {
    const dialogRef = this.dialog.open(AccountDetailDialog, {
      autoFocus: false,
      data: <AccountDetailDialogParams>{
        accountId: aAccountId,
        deviceType: this.deviceType,
        hasImpersonationId: this.hasImpersonationId
      },
      height: this.deviceType === 'mobile' ? '97.5vh' : '80vh',
      width: this.deviceType === 'mobile' ? '100vw' : '50rem'
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe(() => {
        this.router.navigate(['.'], { relativeTo: this.route });
      });
  }

  private openPositionDialog({
    dataSource,
    symbol
  }: {
    dataSource: DataSource;
    symbol: string;
  }) {
    this.userService
      .get()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((user) => {
        this.user = user;

        const dialogRef = this.dialog.open(PositionDetailDialog, {
          autoFocus: false,
          data: <PositionDetailDialogParams>{
            dataSource,
            symbol,
            baseCurrency: this.user?.settings?.baseCurrency,
            colorScheme: this.user?.settings?.colorScheme,
            deviceType: this.deviceType,
            hasImpersonationId: this.hasImpersonationId,
            hasPermissionToReportDataGlitch: hasPermission(
              this.user?.permissions,
              permissions.reportDataGlitch
            ),
            locale: this.user?.settings?.locale
          },
          height: this.deviceType === 'mobile' ? '97.5vh' : '80vh',
          width: this.deviceType === 'mobile' ? '100vw' : '50rem'
        });

        dialogRef
          .afterClosed()
          .pipe(takeUntil(this.unsubscribeSubject))
          .subscribe(() => {
            this.router.navigate(['.'], { relativeTo: this.route });
          });
      });
  }

  private extractEtfProvider({
    assetSubClass,
    name
  }: {
    assetSubClass: PortfolioPosition['assetSubClass'];
    name: string;
  }) {
    if (assetSubClass === 'ETF') {
      const [firstWord] = name.split(' ');
      return firstWord;
    }

    return UNKNOWN_KEY;
  }
}
