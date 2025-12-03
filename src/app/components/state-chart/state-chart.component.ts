import { Component, OnInit, OnDestroy, OnChanges, ElementRef, ViewChild, Input } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, throttleTime } from 'rxjs/operators';
import * as d3 from 'd3';
import { DataPoint, PlotField, TimeRange, HoverEvent, STATE_COLORS } from '../../models/data.model';
import { SyncService } from '../../services/sync.service';

@Component({
  selector: 'app-state-chart',
  templateUrl: './state-chart.component.html',
  styleUrls: ['./state-chart.component.scss']
})
export class StateChartComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;
  @Input() data: DataPoint[] = [];
  @Input() field!: PlotField;
  @Input() height: number = 200;

  private destroy$ = new Subject<void>();
  private mouseMoveSubject$ = new Subject<MouseEvent>();
  private svg: any;
  private margin = { top: 20, right: 20, bottom: 20, left: 40 };
  private width = 600;
  private actualHeight = 0;
  private xScale: any;
  private uniqueStates: string[] = [];
  private stateColorMap: { [key: string]: string } = {};
  private brush: any;
  private currentTimeRange: TimeRange | null = null;

  constructor(private syncService: SyncService) {}

  ngOnInit(): void {
    this.actualHeight = this.height - this.margin.top - this.margin.bottom;
    this.initChart();
    this.subscribeToSync();
    this.setupThrottledMouseMove();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.mouseMoveSubject$.complete();
  }

  private setupThrottledMouseMove(): void {
    this.mouseMoveSubject$
      .pipe(
        takeUntil(this.destroy$),
        throttleTime(50) // Throttle to 20fps max
      )
      .subscribe(event => this.onMouseMoveThrottled(event));
  }

  ngOnChanges(): void {
    console.log('State chart ngOnChanges called for field:', this.field?.key, 'data length:', this.data.length);
    if (this.svg && this.data.length > 0) {
      this.updateChart();
    }
  }

  private subscribeToSync(): void {
    this.syncService.zoom$
      .pipe(takeUntil(this.destroy$))
      .subscribe(timeRange => {
        if (timeRange && timeRange !== this.currentTimeRange) {
          this.currentTimeRange = timeRange;
          this.applyZoom(timeRange);
        } else if (!timeRange) {
          this.resetZoom();
        }
      });
  }

  private initChart(): void {
    const element = this.chartContainer.nativeElement;
    this.width = element.offsetWidth - this.margin.left - this.margin.right;

    this.svg = d3.select(element)
      .append('svg')
      .attr('width', this.width + this.margin.left + this.margin.right)
      .attr('height', this.height)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Add clipping path to prevent segments from overflowing
    this.svg.append('defs')
      .append('clipPath')
      .attr('id', `clip-${this.field.key}`)
      .append('rect')
      .attr('width', this.width)
      .attr('height', this.actualHeight);

    // Initialize scales
    this.xScale = d3.scaleTime()
      .range([0, this.width]);

    // Add axes
    this.svg.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${this.actualHeight})`);

    // Add y-axis label
    this.svg.append('text')
      .attr('class', 'y-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - this.margin.left)
      .attr('x', 0 - (this.actualHeight / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .text(this.field.label);

    // Add centerline for visual balance
    this.svg.append('line')
      .attr('class', 'centerline')
      .style('stroke', '#ddd')
      .style('stroke-width', 1)
      .style('stroke-dasharray', '1,1')
      .style('opacity', 0.5);

    // Add hover line
    this.svg.append('line')
      .attr('class', 'hover-line')
      .style('stroke', '#999')
      .style('stroke-width', 1)
      .style('stroke-dasharray', '3,3')
      .style('opacity', 0);

    // Add tooltip for showing values
    const tooltipGroup = this.svg.append('g')
      .attr('class', 'tooltip')
      .style('opacity', 0);

    tooltipGroup.append('rect')
      .attr('class', 'tooltip-bg')
      .attr('rx', 4)
      .attr('ry', 4)
      .style('fill', 'rgba(0, 0, 0, 0.8)')
      .style('pointer-events', 'none');

    // Add two text lines - datetime and value
    tooltipGroup.append('text')
      .attr('class', 'tooltip-datetime')
      .style('fill', 'white')
      .style('font-size', '11px')
      .style('text-anchor', 'middle')
      .style('pointer-events', 'none');

    tooltipGroup.append('text')
      .attr('class', 'tooltip-value')
      .style('fill', 'white')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .style('text-anchor', 'middle')
      .style('pointer-events', 'none');

    // Add hover overlay (but disable pointer events when brushing)
    this.svg.append('rect')
      .attr('class', 'hover-overlay')
      .attr('width', this.width)
      .attr('height', this.actualHeight)
      .style('fill', 'none')
      .style('pointer-events', 'all')
      .on('mousemove', (event: any) => this.mouseMoveSubject$.next(event))
      .on('mouseleave', () => this.onMouseLeave());

    // Add brush for zooming (on top)
    this.brush = d3.brushX()
      .extent([[0, 0], [this.width, this.actualHeight]])
      .on('start', () => {
        // Disable hover when brushing starts
        this.svg.select('.hover-overlay').style('pointer-events', 'none');
      })
      .on('end', (event) => {
        this.onBrush(event);
        // Re-enable hover when brushing ends
        setTimeout(() => {
          this.svg.select('.hover-overlay').style('pointer-events', 'all');
        }, 100);
      });

    this.svg.append('g')
      .attr('class', 'brush')
      .call(this.brush);

    if (this.data.length > 0) {
      this.updateChart();
    }
  }

  private updateChart(): void {
    if (!this.svg || this.data.length === 0) return;

    // Get unique states and assign colors
    this.uniqueStates = [...new Set(this.data.map(d => String(d[this.field.key])))];
    this.stateColorMap = {};
    this.uniqueStates.forEach((state, index) => {
      this.stateColorMap[state] = STATE_COLORS[index % STATE_COLORS.length];
    });

    // Update time scale
    const timeExtent = d3.extent(this.data, d => d.datetime) as [Date, Date];
    this.xScale.domain(timeExtent);

    // Update x-axis with dynamic time formatting
    const timeSpan = timeExtent[1].getTime() - timeExtent[0].getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    let timeFormat;
    if (timeSpan > oneDayMs) {
      // Show date if span is more than a day
      timeFormat = d3.timeFormat('%m/%d %H:%M') as any;
    } else {
      // Show just time if within a day
      timeFormat = d3.timeFormat('%H:%M') as any;
    }

    this.svg.select('.x-axis')
      .call(d3.axisBottom(this.xScale)
        .tickFormat(timeFormat));

    // Update centerline position
    const centerline = this.svg.select('.centerline');
    const centerlineY = this.actualHeight / 2;
    centerline
      .attr('x1', 0)
      .attr('x2', this.width)
      .attr('y1', centerlineY)
      .attr('y2', centerlineY);

    // Create state segments
    this.createStateSegments();

    // Create legend
    this.createLegend();
  }

  private createStateSegments(): void {
    // Create segments for each state change, handling null values
    const segments: any[] = [];
    const nullGaps: any[] = [];
    let currentState = this.data[0][this.field.key];
    let segmentStart = this.data[0].datetime;
    let isCurrentNull = currentState === null || currentState === undefined;

    for (let i = 1; i < this.data.length; i++) {
      const newState = this.data[i][this.field.key];
      const isNewNull = newState === null || newState === undefined;
      
      if (isNewNull !== isCurrentNull || (!isNewNull && String(newState) !== String(currentState))) {
        // End current segment
        if (isCurrentNull) {
          // Add to null gaps
          nullGaps.push({
            start: segmentStart,
            end: this.data[i].datetime
          });
        } else {
          // Add to regular segments
          segments.push({
            state: String(currentState),
            start: segmentStart,
            end: this.data[i].datetime,
            color: this.stateColorMap[String(currentState)]
          });
        }
        
        // Start new segment
        currentState = newState;
        segmentStart = this.data[i].datetime;
        isCurrentNull = isNewNull;
      }
    }

    // Add final segment
    if (isCurrentNull) {
      nullGaps.push({
        start: segmentStart,
        end: this.data[this.data.length - 1].datetime
      });
    } else {
      segments.push({
        state: String(currentState),
        start: segmentStart,
        end: this.data[this.data.length - 1].datetime,
        color: this.stateColorMap[String(currentState)]
      });
    }

    // Create a group for segments with clipping
    let segmentGroup = this.svg.select('.segment-group');
    if (segmentGroup.empty()) {
      segmentGroup = this.svg.append('g')
        .attr('class', 'segment-group')
        .attr('clip-path', `url(#clip-${this.field.key})`);
    }

    // Remove existing segments from the group
    segmentGroup.selectAll('.state-segment').remove();
    segmentGroup.selectAll('.null-gap').remove();

    // Draw null gaps as red background areas
    segmentGroup.selectAll('.null-gap')
      .data(nullGaps)
      .enter()
      .append('rect')
      .attr('class', 'null-gap')
      .attr('x', (d: any) => Math.max(0, this.xScale(d.start)))
      .attr('y', 0)
      .attr('width', (d: any) => {
        const startX = Math.max(0, this.xScale(d.start));
        const endX = Math.min(this.width, this.xScale(d.end));
        return Math.max(1, endX - startX);
      })
      .attr('height', this.actualHeight)
      .style('fill', 'rgba(255, 0, 0, 0.1)')
      .style('stroke', 'rgba(255, 0, 0, 0.3)')
      .style('stroke-width', 1)
      .style('pointer-events', 'none');

    // Draw regular state segments
    segmentGroup.selectAll('.state-segment')
      .data(segments)
      .enter()
      .append('rect')
      .attr('class', 'state-segment')
      .attr('x', (d: any) => Math.max(0, this.xScale(d.start)))
      .attr('y', 10 + (this.actualHeight - 20) / 4)
      .attr('width', (d: any) => {
        const startX = Math.max(0, this.xScale(d.start));
        const endX = Math.min(this.width, this.xScale(d.end));
        return Math.max(1, endX - startX);
      })
      .attr('height', (this.actualHeight - 20) / 2)
      .attr('fill', (d: any) => d.color)
      .attr('opacity', 0.7)
      .append('title')
      .text((d: any) => `${this.field.label}: ${d.state}`);
  }

  private createLegend(): void {
    // Remove existing legend
    this.svg.selectAll('.legend').remove();

    // Position legend in the title area (left-aligned, above the chart area)
    const legend = this.svg.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(0, ${-this.margin.top + 5})`);

    // Create horizontal legend items starting from the left
    let xOffset = 0;
    let yOffset = 0;
    const maxWidth = this.width - 20; // Leave some margin
    const lineHeight = 12;
    
    this.uniqueStates.forEach((state, i) => {
      const legendItem = legend.append('g')
        .attr('class', 'legend-item')
        .attr('transform', `translate(${xOffset}, ${yOffset})`);

      legendItem.append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', this.stateColorMap[state]);

      const text = legendItem.append('text')
        .attr('x', 14)
        .attr('y', 8)
        .text(state)
        .style('font-size', '9px')
        .style('fill', '#333');

      // Calculate width for next item positioning
      const textWidth = (text.node() as any)?.getBBox()?.width || 30;
      const itemWidth = textWidth + 20; // 14 (rect + spacing) + text width + gap
      
      // Check if we need to wrap to next line
      if (xOffset + itemWidth > maxWidth && i > 0) {
        xOffset = 0;
        yOffset += lineHeight;
      }
      
      xOffset += itemWidth;
    });
  }

  private onBrush(event: any): void {
    console.log('State chart brush event triggered:', event);
    if (!event.selection) {
      console.log('No brush selection in state chart');
      return;
    }

    const [x0, x1] = event.selection;
    const start = this.xScale.invert(x0);
    const end = this.xScale.invert(x1);

    console.log('State chart brush selection:', { x0, x1, start, end });
    const timeRange: TimeRange = { start, end };
    this.syncService.emitZoom(timeRange);
    
    // Clear the brush selection after emitting zoom
    setTimeout(() => {
      this.svg.select('.brush').call(this.brush.move, null);
    }, 100);
  }

  private onMouseMoveThrottled(event: MouseEvent): void {
    const [mouseX] = d3.pointer(event);
    const date = this.xScale.invert(mouseX);

    // Find closest data point
    const bisect = d3.bisector((d: DataPoint) => d.datetime).left;
    const index = bisect(this.data, date);
    
    let closestPoint: DataPoint;
    if (index === 0) {
      closestPoint = this.data[0];
    } else if (index === this.data.length) {
      closestPoint = this.data[this.data.length - 1];
    } else {
      const left = this.data[index - 1];
      const right = this.data[index];
      closestPoint = (date.getTime() - left.datetime.getTime()) > (right.datetime.getTime() - date.getTime()) ? right : left;
    }

    if (closestPoint) {
      const x = this.xScale(closestPoint.datetime);

      // Update hover line
      this.svg.select('.hover-line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', 0)
        .attr('y2', this.actualHeight)
        .style('opacity', 1);

      // Update tooltip
      const value = closestPoint[this.field.key];
      const formattedDateTime = closestPoint.datetime.toLocaleString();
      
      // Update tooltip text elements
      const tooltip = this.svg.select('.tooltip');
      const datetimeElement = tooltip.select('.tooltip-datetime');
      const valueElement = tooltip.select('.tooltip-value');
      
      datetimeElement.text(formattedDateTime);
      valueElement.text(`${this.field.label}: ${value}`);
      
      // Get text dimensions for tooltip background
      const datetimeBBox = (datetimeElement.node() as any)?.getBBox();
      const valueBBox = (valueElement.node() as any)?.getBBox();
      
      if (datetimeBBox && valueBBox) {
        const padding = 8;
        const lineHeight = 16;
        const maxWidth = Math.max(datetimeBBox.width, valueBBox.width);
        const totalHeight = lineHeight * 2;
        
        const tooltipBg = tooltip.select('.tooltip-bg');
        tooltipBg
          .attr('width', maxWidth + padding * 2)
          .attr('height', totalHeight + padding * 2)
          .attr('x', -maxWidth / 2 - padding)
          .attr('y', -totalHeight - padding);
        
        // Position text elements
        datetimeElement
          .attr('x', 0)
          .attr('y', -totalHeight + lineHeight - padding);
        
        valueElement
          .attr('x', 0)
          .attr('y', -padding);
      }
      
      // Position tooltip above the state chart
      const tooltipX = Math.min(Math.max(x, 50), this.width - 50); // Keep within bounds
      const tooltipY = Math.max(this.actualHeight / 2 - 20, 20); // Position in middle area
      
      tooltip
        .attr('transform', `translate(${tooltipX}, ${tooltipY})`)
        .style('opacity', 1);

      // Emit hover event
      const hoverEvent: HoverEvent = {
        dataPoint: closestPoint,
        x: event.clientX,
        y: event.clientY
      };
      this.syncService.emitHover(hoverEvent);
    }
  }

  private onMouseLeave(): void {
    this.svg.select('.hover-line').style('opacity', 0);
    this.svg.select('.tooltip').style('opacity', 0);
    this.syncService.emitHover(null);
  }

  private applyZoom(timeRange: TimeRange): void {
    this.xScale.domain([timeRange.start, timeRange.end]);
    
    // Update axis with dynamic formatting based on zoom level
    const timeSpan = timeRange.end.getTime() - timeRange.start.getTime();
    const oneHourMs = 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    let timeFormat;
    if (timeSpan > oneDayMs) {
      timeFormat = d3.timeFormat('%m/%d %H:%M') as any;
    } else if (timeSpan > oneHourMs) {
      // Show date and time when zoomed to less than a day but more than an hour
      timeFormat = d3.timeFormat('%m/%d %H:%M') as any;
    } else {
      // Show date and time with seconds for very precise zoom
      timeFormat = d3.timeFormat('%m/%d %H:%M:%S') as any;
    }
    
    this.svg.select('.x-axis')
      .call(d3.axisBottom(this.xScale)
        .tickFormat(timeFormat));

    // Update centerline position for zoomed view
    const centerline = this.svg.select('.centerline');
    const centerlineY = this.actualHeight / 2;
    centerline
      .attr('x1', 0)
      .attr('x2', this.width)
      .attr('y1', centerlineY)
      .attr('y2', centerlineY);

    // Recreate segments for the new time range
    this.createStateSegments();
  }

  private resetZoom(): void {
    const timeExtent = d3.extent(this.data, d => d.datetime) as [Date, Date];
    this.xScale.domain(timeExtent);
    
    // Reset to original time formatting
    const timeSpan = timeExtent[1].getTime() - timeExtent[0].getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    let timeFormat;
    if (timeSpan > oneDayMs) {
      timeFormat = d3.timeFormat('%m/%d %H:%M') as any;
    } else {
      timeFormat = d3.timeFormat('%H:%M') as any;
    }
    
    this.svg.select('.x-axis')
      .call(d3.axisBottom(this.xScale)
        .tickFormat(timeFormat));

    // Update centerline position for reset view
    const centerline = this.svg.select('.centerline');
    const centerlineY = this.actualHeight / 2;
    centerline
      .attr('x1', 0)
      .attr('x2', this.width)
      .attr('y1', centerlineY)
      .attr('y2', centerlineY);

    this.createStateSegments();

    // Clear brush
    this.svg.select('.brush').call(this.brush.move, null);
    this.currentTimeRange = null;
  }
}