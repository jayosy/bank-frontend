import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { BackendHealth } from '../models/backend-health';

@Injectable({
  providedIn: 'root'
})
export class BackendHealthService {
  private readonly http = inject(HttpClient);

  getHealth(): Observable<BackendHealth> {
    return this.http.get<BackendHealth>('/actuator/health');
  }
}