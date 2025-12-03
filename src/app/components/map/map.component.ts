import { Component, OnInit, OnDestroy, OnChanges, ElementRef, ViewChild, Input } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as L from 'leaflet';
import { DataPoint, HoverEvent, TimeRange } from '../../models/data.model';
import { SyncService } from '../../services/sync.service';

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;
  @Input() data: DataPoint[] = [];

  private destroy$ = new Subject<void>();
  private map!: L.Map;
  private pathPolyline!: L.Polyline;
  private currentMarker!: L.Marker;
  private isInitialized = false;
  private isUpdatingZoom = false;
  private lastZoomTimeRange: TimeRange | null = null;
  private zoomTimeout: any = null;

  constructor(private syncService: SyncService) {}

  ngOnInit(): void {
    // Give the DOM a moment to render
    setTimeout(() => {
      this.initMap();
      this.subscribeToHover();
    }, 100);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Clear any pending zoom timeout
    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout);
    }
    
    if (this.map) {
      this.map.remove();
    }
  }

  ngOnChanges(): void {
    console.log('Map ngOnChanges called with data length:', this.data.length);
    if (this.isInitialized && this.data.length > 0) {
      console.log('Map updating path with data:', this.data[0]);
      console.log('First GPS location:', this.data[0].latitude, this.data[0].longitude);
      
      // Ensure map is properly sized before updating
      setTimeout(() => {
        this.map.invalidateSize();
        this.updatePath();
      }, 50);
    }
  }

  private initMap(): void {
    // Fix Leaflet default icon path issues
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });

    // Initialize the map
    console.log('Map container element:', this.mapContainer.nativeElement);
    console.log('Map container dimensions:', this.mapContainer.nativeElement.offsetWidth, 'x', this.mapContainer.nativeElement.offsetHeight);
    
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [37.7749, -122.4194], // Default to San Francisco
      zoom: 13
    });

    console.log('Map initialized:', this.map);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Initialize current position marker
    const currentIcon = L.divIcon({
      className: 'current-position-marker',
      html: '<div class="marker-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    this.currentMarker = L.marker([37.7749, -122.4194], { icon: currentIcon })
      .addTo(this.map);

    this.isInitialized = true;

    // Force map to recalculate its size
    setTimeout(() => {
      this.map.invalidateSize();
      console.log('Map size invalidated');
      
      if (this.data.length > 0) {
        console.log('Initial data available, updating map to first GPS location');
        this.updatePath();
      }
    }, 200);
  }

  private subscribeToHover(): void {
    this.syncService.hover$
      .pipe(takeUntil(this.destroy$))
      .subscribe(hoverEvent => {
        console.log('Map received hover event:', hoverEvent);
        if (hoverEvent) {
          console.log('Updating map position to:', hoverEvent.dataPoint.latitude, hoverEvent.dataPoint.longitude);
          this.updateCurrentPosition(hoverEvent.dataPoint);
        }
      });

    // Subscribe to zoom events to update the map path
    this.syncService.zoom$
      .pipe(takeUntil(this.destroy$))
      .subscribe(timeRange => {
        // Clear any pending zoom timeout
        if (this.zoomTimeout) {
          clearTimeout(this.zoomTimeout);
        }
        
        if (timeRange) {
          // Prevent multiple zoom operations for the same time range
          if (this.isUpdatingZoom) {
            console.log('Map zoom update already in progress, skipping');
            return;
          }
          
          // Check if this is the same time range as the last one (with small tolerance for floating point differences)
          if (this.lastZoomTimeRange && 
              Math.abs(this.lastZoomTimeRange.start.getTime() - timeRange.start.getTime()) < 1000 &&
              Math.abs(this.lastZoomTimeRange.end.getTime() - timeRange.end.getTime()) < 1000) {
            console.log('Map received duplicate zoom event, skipping');
            return;
          }
          
          // Debounce zoom updates to prevent rapid successive calls
          this.zoomTimeout = setTimeout(() => {
            this.updatePathForTimeRange(timeRange);
          }, 50);
        } else {
          // Reset to full data
          this.updatePath();
        }
      });
  }

  private updatePath(): void {
    if (!this.map || this.data.length === 0) return;

    try {
      // Create path from all data points
      const latlngs: L.LatLngExpression[] = this.data.map(point => [point.latitude, point.longitude]);

      // Remove existing path if it exists
      if (this.pathPolyline) {
        this.map.removeLayer(this.pathPolyline);
      }

      // Create new path
      this.pathPolyline = L.polyline(latlngs, {
        color: '#2196F3', // Blue for full data view
        weight: 3,
        opacity: 0.7
      }).addTo(this.map);

      // Update current marker to first position
      if (this.data.length > 0) {
        this.updateCurrentPosition(this.data[0]);
      }

      // Fit map to path bounds with animation disabled to prevent multiple zooms
      if (latlngs.length > 1) {
        this.map.fitBounds(this.pathPolyline.getBounds(), { 
          padding: [20, 20],
          animate: false // Disable animation to prevent multiple zoom events
        });
      } else if (latlngs.length === 1) {
        // Center on the first GPS location with appropriate zoom level
        this.centerMapOnFirstLocation();
      }
    } catch (error) {
      console.error('Error updating map path:', error);
    }
  }

  private updateCurrentPosition(dataPoint: DataPoint): void {
    console.log('updateCurrentPosition called with:', dataPoint.latitude, dataPoint.longitude);
    if (!this.currentMarker) {
      console.log('No current marker found');
      return;
    }

    if (!dataPoint.latitude || !dataPoint.longitude) {
      console.log('Invalid lat/lng in dataPoint:', dataPoint);
      return;
    }

    const latlng: L.LatLngExpression = [dataPoint.latitude, dataPoint.longitude];
    console.log('Setting marker position to:', latlng);
    this.currentMarker.setLatLng(latlng);

    // Optionally pan to the current position (comment out if too distracting)
    // this.map.panTo(latlng);
  }

  private centerMapOnFirstLocation(): void {
    if (!this.map || this.data.length === 0) return;

    const firstPoint = this.data[0];
    if (!firstPoint.latitude || !firstPoint.longitude) {
      console.log('Invalid GPS coordinates in first data point');
      return;
    }

    const firstLocation: L.LatLngExpression = [firstPoint.latitude, firstPoint.longitude];
    console.log('Centering map on first GPS location:', firstLocation);
    
    // Center the map on the first GPS location with a good zoom level
    this.map.setView(firstLocation, 15, { animate: false });
    
    // Update the current marker to the first position
    this.updateCurrentPosition(firstPoint);
  }

  private updatePathForTimeRange(timeRange: TimeRange): void {
    if (!this.map || this.data.length === 0) return;

    // Double-check we're not already updating
    if (this.isUpdatingZoom) {
      console.log('Map zoom update already in progress, skipping duplicate call');
      return;
    }

    try {
      this.isUpdatingZoom = true;
      this.lastZoomTimeRange = timeRange;

      // Filter data points within the time range
      const filteredData = this.data.filter(point => 
        point.datetime >= timeRange.start && point.datetime <= timeRange.end
      );

      if (filteredData.length === 0) {
        console.log('No data points in time range, skipping map update');
        return;
      }

      // Create path from filtered data points
      const latlngs: L.LatLngExpression[] = filteredData.map(point => [point.latitude, point.longitude]);

      // Remove existing path if it exists
      if (this.pathPolyline) {
        this.map.removeLayer(this.pathPolyline);
      }

      // Create new path for the time range
      this.pathPolyline = L.polyline(latlngs, {
        color: '#FF6B35', // Different color to indicate filtered view
        weight: 3,
        opacity: 0.8
      }).addTo(this.map);

      // Fit map to the filtered path bounds with animation disabled to prevent multiple zooms
      if (latlngs.length > 1) {
        // Use a small delay to ensure the polyline is fully rendered before fitting bounds
        setTimeout(() => {
          if (this.pathPolyline && this.map) {
            this.map.fitBounds(this.pathPolyline.getBounds(), { 
              padding: [20, 20],
              animate: false // Disable animation to prevent multiple zoom events
            });
          }
        }, 10);
      } else if (latlngs.length === 1) {
        this.map.setView(latlngs[0] as L.LatLngExpression, 15, { animate: false });
      }

      // Update current marker to first position in range
      if (filteredData.length > 0) {
        this.updateCurrentPosition(filteredData[0]);
      }

      console.log('Map updated for time range:', timeRange, 'showing', filteredData.length, 'points');
    } catch (error) {
      console.error('Error updating map for time range:', error);
    } finally {
      // Reset the flag after a short delay to allow for any pending operations
      setTimeout(() => {
        this.isUpdatingZoom = false;
      }, 150);
    }
  }
}