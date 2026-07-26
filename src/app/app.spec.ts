import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import {
  ComponentFixture,
  TestBed
} from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { App } from './app';

describe('App', () => {
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    /*
     * Garantit que chaque test repart avec un TestBed neuf.
     * Cela évite :
     * "Cannot configure the test module when the test module
     * has already been instantiated".
     */
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    httpTestingController =
      TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    /*
     * Vérifie qu'aucune requête HTTP simulée
     * n'est restée sans réponse.
     */
    httpTestingController.verify();

    TestBed.resetTestingModule();
  });

  async function createApplication():
    Promise<ComponentFixture<App>> {
    const fixture = TestBed.createComponent(App);

    /*
     * Déclenche ngOnInit(), donc l'appel GET /api/health.
     */
    fixture.detectChanges();

    const request = httpTestingController.expectOne({
      method: 'GET',
      url: '/actuator/health'
    });

    request.flush({
      status: 'UP',
      service: 'Bank Platform API'
    });

    /*
     * Attend que les signaux et le change detection
     * zoneless aient propagé la réponse.
     */
    await fixture.whenStable();

    fixture.detectChanges();

    return fixture;
  }

  it('should create the application', async () => {
    const fixture = await createApplication();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the dashboard heading', async () => {
    const fixture = await createApplication();
    const element = fixture.nativeElement as HTMLElement;

    const heading = element.querySelector('h1');

    expect(heading?.textContent).toContain(
      'Pilotez vos opérations bancaires'
    );
  });

  it('should render the recent transactions', async () => {
    const fixture = await createApplication();
    const element = fixture.nativeElement as HTMLElement;

    const transactionRows = element.querySelectorAll(
      '.transactions-table tbody tr'
    );

    expect(transactionRows.length).toBe(4);
  });

  it('should display the backend as available', async () => {
    const fixture = await createApplication();
    const element = fixture.nativeElement as HTMLElement;

    const backendState = element.querySelector(
      '.service-state--online'
    );

    expect(backendState?.textContent?.trim()).toBe(
      'Disponible'
    );
  });
});