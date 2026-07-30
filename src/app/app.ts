import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';

import { BackendHealth } from './core/models/backend-health';
import { BackendHealthService } from './core/services/backend-health.service';

interface DashboardMetric {
  readonly label: string;
  readonly value: string;
  readonly evolution: string;
  readonly description: string;
  readonly trend: 'positive' | 'neutral';
}

interface RecentTransaction {
  readonly reference: string;
  readonly type: string;
  readonly counterparty: string;
  readonly amount: string;
  readonly date: string;
  readonly status: 'Succès' | 'En attente' | 'Échec';
}

@Component({
  selector: 'bank-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit{

  private readonly backendHealthService =
  inject(BackendHealthService);

  protected readonly backendHealth =
    signal<BackendHealth | null>(null);

  protected readonly backendConnectionState =
    signal<BackendConnectionState>('loading');

  ngOnInit(): void {
    this.loadBackendStatus();
  }

  protected loadBackendStatus(): void {
    this.backendConnectionState.set('loading');
    this.backendHealth.set(null);

    this.backendHealthService.getHealth().subscribe({
      next: (health: BackendHealth) => {
        this.backendHealth.set(health);

        this.backendConnectionState.set(
          health.status.toUpperCase() === 'UP'
            ? 'online'
            : 'offline'
        );
      },
      error: () => {
        this.backendHealth.set(null);
        this.backendConnectionState.set('offline');
      }
    });
  }
  
  protected readonly applicationName = 'Platform';

  protected readonly metrics: readonly DashboardMetric[] = [
    {
      label: 'Transactions du jour',
      value: '1 248',
      evolution: '+12,5 %',
      description: 'Par rapport à hier',
      trend: 'positive'
    },
    {
      label: 'Volume traité',
      value: '84,6 M FCFA',
      evolution: '+8,2 %',
      description: 'Sur les dernières 24 heures',
      trend: 'positive'
    },
    {
      label: 'Taux de succès',
      value: '99,72 %',
      evolution: 'Stable',
      description: 'Objectif supérieur à 99,5 %',
      trend: 'neutral'
    },
    {
      label: 'Temps de réponse',
      value: '186 ms',
      evolution: '-24 ms',
      description: 'Moyenne des appels API',
      trend: 'positive'
    }
  ];

  protected readonly recentTransactions: readonly RecentTransaction[] = [
    {
      reference: 'TRX-2026-0726-001',
      type: 'Paiement marchand',
      counterparty: 'Marché Central',
      amount: '125 000 FCFA',
      date: '26 juil. 2026 · 12:42',
      status: 'Succès'
    },
    {
      reference: 'TRX-2026-0726-002',
      type: 'Virement bancaire',
      counterparty: 'Entreprise Horizon',
      amount: '850 000 FCFA',
      date: '26 juil. 2026 · 12:37',
      status: 'En attente'
    },
    {
      reference: 'TRX-2026-0726-003',
      type: 'Paiement marchand',
      counterparty: 'Boutique Teranga',
      amount: '42 500 FCFA',
      date: '26 juil. 2026 · 12:25',
      status: 'Succès'
    },
    {
      reference: 'TRX-2026-0726-004',
      type: 'Retrait',
      counterparty: 'Agence Plateau',
      amount: '200 000 FCFA',
      date: '26 juil. 2026 · 12:08',
      status: 'Échec'
    }
  ];

  protected statusClass(status: RecentTransaction['status']): string {
    switch (status) {
      case 'Succès':
        return 'status status--success';
      case 'En attente':
        return 'status status--pending';
      case 'Échec':
        return 'status status--failed';
    }
  }

}

type BackendConnectionState =
  | 'loading'
  | 'online'
  | 'offline';