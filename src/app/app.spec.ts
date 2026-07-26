import { TestBed } from '@angular/core/testing';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App]
    }).compileComponents();
  });

  it('should create the application', () => {
    const fixture = TestBed.createComponent(App);
    const application = fixture.componentInstance;

    expect(application).toBeTruthy();
  });

  it('should render the dashboard heading', () => {
    const fixture = TestBed.createComponent(App);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const heading = element.querySelector('h1');

    expect(heading?.textContent).toContain(
      'Pilotez vos opérations bancaires'
    );
  });

  it('should render the recent transactions', () => {
    const fixture = TestBed.createComponent(App);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const transactionRows = element.querySelectorAll(
      '.transactions-table tbody tr'
    );

    expect(transactionRows.length).toBe(4);
  });
});