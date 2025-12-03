import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { HoverEvent, ZoomEvent, TimeRange } from '../models/data.model';

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  private hoverSubject = new Subject<HoverEvent | null>();
  private zoomSubject = new BehaviorSubject<TimeRange | null>(null);
  private dataBounds: TimeRange | null = null;
  
  public hover$ = this.hoverSubject.asObservable();
  public zoom$ = this.zoomSubject.asObservable();

  constructor() { }

  public emitHover(event: HoverEvent | null): void {
    console.log('SyncService emitting hover:', event?.dataPoint?.datetime, event?.dataPoint?.latitude, event?.dataPoint?.longitude);
    this.hoverSubject.next(event);
  }

  public setDataBounds(bounds: TimeRange): void {
    this.dataBounds = bounds;
  }

  public emitZoom(timeRange: TimeRange): void {
    // Clamp zoom to data bounds if they exist
    if (this.dataBounds) {
      const clampedStart = new Date(Math.max(timeRange.start.getTime(), this.dataBounds.start.getTime()));
      const clampedEnd = new Date(Math.min(timeRange.end.getTime(), this.dataBounds.end.getTime()));
      
      timeRange = {
        start: clampedStart,
        end: clampedEnd
      };
    }
    
    console.log('SyncService emitting zoom:', timeRange);
    this.zoomSubject.next(timeRange);
  }

  public getCurrentZoom(): TimeRange | null {
    return this.zoomSubject.value;
  }

  public clearZoom(): void {
    this.zoomSubject.next(null);
  }
}
