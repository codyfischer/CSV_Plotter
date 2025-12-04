import { Component, OnInit, OnDestroy, OnChanges, ElementRef, ViewChild, Input } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, throttleTime } from 'rxjs/operators';
import * as d3 from 'd3';
import { DataPoint, PlotField, TimeRange, HoverEvent } from '../../models/data.model';
import { SyncService } from '../../services/sync.service';

@Component({
  selector: 'app-chart',
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss']
})
export class ChartComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;
  @Input() data: DataPoint[] = [];
  @Input() field!: PlotField;
  @Input() height: number = 150;

  private destroy$ = new Subject<void>();
  private mouseMoveSubject$ = new Subject<MouseEvent>();
  private svg: any;
  private margin = { top: 10, right: 15, bottom: 25, left: 40 };
  private width = 600;
  private actualHeight = 0;
  private xScale: any;
  private yScale: any;
  private line: any;
  private brush: any;
  private zoom: any;
  private currentTimeRange: TimeRange | null = null;
  private decimatedData: DataPoint[] = [];
  private isUpdatingZoom = false;

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

  ngOnChanges(): void {
    if (this.svg && this.data.length > 0) {
      this.decimatedData = this.decimateData(this.data);
      this.updateChart();
    }
  }

  private setupThrottledMouseMove(): void {
    this.mouseMoveSubject$
      .pipe(
        takeUntil(this.destroy$),
        throttleTime(50) // Throttle to 20fps max
      )
      .subscribe(event => {
        this.onMouseMoveThrottled(event);
      });
  }

  private decimateData(data: DataPoint[]): DataPoint[] {
    // More conservative decimation - keep more points for better zoom experience
    if (data.length <= 2000) {
      return data;
    }

    // For very large datasets, keep every nth point to maintain ~2000 points
    const targetPoints = 2000;
    const step = Math.ceil(data.length / targetPoints);
    const decimated: DataPoint[] = [];
    
    for (let i = 0; i < data.length; i += step) {
      decimated.push(data[i]);
    }
    
    // Always include the last point
    if (decimated[decimated.length - 1] !== data[data.length - 1]) {
      decimated.push(data[data.length - 1]);
    }
    
    return decimated;
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

    const svgElement = d3.select(element)
      .append('svg')
      .attr('width', this.width + this.margin.left + this.margin.right)
      .attr('height', this.height)
      .style('pointer-events', 'all');
    
    this.svg = svgElement
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Initialize scales
    this.xScale = d3.scaleTime()
      .range([0, this.width]);

    this.yScale = d3.scaleLinear()
      .range([this.actualHeight, 0]);

    // Initialize line generator
    this.line = d3.line<DataPoint>()
      .x(d => this.xScale(d.datetime))
      .y(d => {
        const value = d[this.field.key] as number;
        if (value === undefined || value === null || isNaN(value)) {
          return 0;
        }
        return this.yScale(value);
      })
      .curve(d3.curveMonotoneX)
      .defined((d, i, data) => {
        // Ensure the point is within the x-scale domain to prevent extending beyond boundaries
        const x = this.xScale(d.datetime);
        const y = d[this.field.key] as number;
        
        // Point is defined if:
        // 1. It's within the x-scale domain
        // 2. It has a valid numeric value (not null, undefined, or NaN)
        return x >= 0 && x <= this.width && !isNaN(x) && 
               y !== null && y !== undefined && !isNaN(y);
      });

    // Add clipping path to prevent line from overflowing during zoom
    this.svg.append('defs')
      .append('clipPath')
      .attr('id', `clip-${this.field.key}`)
      .append('rect')
      .attr('width', this.width)
      .attr('height', this.actualHeight);

    // Add axes
    this.svg.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${this.actualHeight})`);

    this.svg.append('g')
      .attr('class', 'y-axis');

    // Add axis labels
    this.svg.append('text')
      .attr('class', 'y-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - this.margin.left)
      .attr('x', 0 - (this.actualHeight / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .text(this.field.label);

    // Add centerline (zero line) for better value distinction
    this.svg.append('line')
      .attr('class', 'centerline')
      .style('stroke', '#666')
      .style('stroke-width', 1)
      .style('stroke-dasharray', '2,2')
      .style('opacity', 0.7);

    // Add hover line and dot
    this.svg.append('line')
      .attr('class', 'hover-line')
      .style('stroke', '#999')
      .style('stroke-width', 1)
      .style('stroke-dasharray', '3,3')
      .style('opacity', 0);

    this.svg.append('circle')
      .attr('class', 'hover-dot')
      .attr('r', 4)
      .style('fill', this.field.color)
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
    const hoverOverlay = this.svg.append('rect')
      .attr('class', 'hover-overlay')
      .attr('width', this.width)
      .attr('height', this.actualHeight)
      .style('fill', 'none')
      .style('pointer-events', 'all')
      .on('mousemove', (event: any) => {
        this.mouseMoveSubject$.next(event);
      })
      .on('mouseleave', () => {
        this.onMouseLeave();
      });

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
      this.decimatedData = this.decimateData(this.data);
      this.updateChart();
    }
  }

  private updateChart(): void {
    if (!this.svg || this.data.length === 0) {
      return;
    }

    if (!this.decimatedData || this.decimatedData.length === 0) {
      return;
    }

    // Update scales using full data for extent but decimated data for drawing
    const timeExtent = d3.extent(this.data, d => d.datetime) as [Date, Date];
    
    // Filter out null values when calculating value extent
    const validValues = this.data
      .map(d => d[this.field.key] as number)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    
    const valueExtent = d3.extent(validValues) as [number, number];

    this.xScale.domain(timeExtent);
    this.yScale.domain(valueExtent);

    // Update axes with dynamic time formatting
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

    this.svg.select('.y-axis')
      .call(d3.axisLeft(this.yScale));

    // Update centerline visibility and position
    this.updateCenterline();

    // Update or create line path with clipping using decimated data
    let lineGroup = this.svg.select('.line-group');
    if (lineGroup.empty()) {
      lineGroup = this.svg.append('g')
        .attr('class', 'line-group')
        .attr('clip-path', `url(#clip-${this.field.key})`);
    }

    const linePathData = this.line(this.decimatedData);

    // Clear existing lines and create new one
    lineGroup.selectAll('.line').remove();
    lineGroup.selectAll('.null-gap').remove();
    
    // Draw null data gaps as red background areas
    this.drawNullGaps(lineGroup);
    
    lineGroup.append('path')
      .datum(this.decimatedData)
      .attr('class', 'line')
      .attr('d', this.line)
      .style('fill', 'none')
      .style('stroke', this.field.color)
      .style('stroke-width', 2);
  }

  private updateCenterline(): void {
    // Filter out null values when calculating value extent
    const validValues = this.data
      .map(d => d[this.field.key] as number)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    
    const valueExtent = d3.extent(validValues) as [number, number];
    const hasNegativeValues = valueExtent[0] < 0;
    const hasPositiveValues = valueExtent[1] > 0;
    
    const centerline = this.svg.select('.centerline');
    if (hasNegativeValues && hasPositiveValues) {
      // Show centerline when data crosses zero
      const centerlineY = this.yScale(0);
      centerline
        .attr('x1', 0)
        .attr('x2', this.width)
        .attr('y1', centerlineY)
        .attr('y2', centerlineY)
        .style('opacity', 0.7);
    } else {
      // Hide centerline when data doesn't cross zero
      centerline.style('opacity', 0);
    }
  }

  private drawNullGaps(lineGroup: any): void {
    const nullGaps = this.findNullGaps();
    
    nullGaps.forEach(gap => {
      const x1 = this.xScale(gap.start);
      const x2 = this.xScale(gap.end);
      
      if (x1 < this.width && x2 > 0) {
        lineGroup.append('rect')
          .attr('class', 'null-gap')
          .attr('x', Math.max(0, x1))
          .attr('y', 0)
          .attr('width', Math.min(this.width, x2) - Math.max(0, x1))
          .attr('height', this.actualHeight)
          .style('fill', 'rgba(255, 0, 0, 0.1)')
          .style('stroke', 'rgba(255, 0, 0, 0.3)')
          .style('stroke-width', 1)
          .style('pointer-events', 'none');
      }
    });
  }

  private findNullGaps(): Array<{start: Date, end: Date}> {
    const gaps: Array<{start: Date, end: Date}> = [];
    let gapStart: Date | null = null;
    
    for (let i = 0; i < this.data.length; i++) {
      const point = this.data[i];
      const value = point[this.field.key] as number;
      const isNull = value === null || value === undefined || isNaN(value);
      
      if (isNull && gapStart === null) {
        // Start of a null gap
        gapStart = point.datetime;
      } else if (!isNull && gapStart !== null) {
        // End of a null gap
        gaps.push({ start: gapStart, end: point.datetime });
        gapStart = null;
      }
    }
    
    // Handle case where data ends with null values
    if (gapStart !== null && this.data.length > 0) {
      gaps.push({ start: gapStart, end: this.data[this.data.length - 1].datetime });
    }
    
    return gaps;
  }

  private onBrush(event: any): void {
    if (!event.selection) {
      return;
    }

    const [x0, x1] = event.selection;
    const start = this.xScale.invert(x0);
    const end = this.xScale.invert(x1);

    const timeRange: TimeRange = { start, end };
    this.syncService.emitZoom(timeRange);
    
    // Clear the brush selection after emitting zoom
    setTimeout(() => {
      this.svg.select('.brush').call(this.brush.move, null);
    }, 100);
  }

  private onMouseMoveThrottled(event: MouseEvent): void {
    // Get mouse position relative to the SVG element
    const svgElement = this.chartContainer.nativeElement.querySelector('svg');
    if (!svgElement) return;
    
    const rect = svgElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left - this.margin.left;
    
    // console.log('Mouse X relative to chart:', mouseX, 'chart width:', this.width);
    
    // Check if mouse is within chart bounds
    if (mouseX < 0 || mouseX > this.width) {
      return;
    }
    
    const date = this.xScale.invert(mouseX);

    // Find closest data point from FULL dataset for accurate hover
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
      const y = this.yScale(closestPoint[this.field.key] as number);

      // Update hover elements
      this.svg.select('.hover-line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', 0)
        .attr('y2', this.actualHeight)
        .style('opacity', 1);

      this.svg.select('.hover-dot')
        .attr('cx', x)
        .attr('cy', y)
        .style('opacity', 1);

      // Update tooltip
      const value = closestPoint[this.field.key] as number;
      const formattedValue = typeof value === 'number' ? value.toFixed(2) : value;
      const formattedDateTime = closestPoint.datetime.toLocaleString();
      
      // Update tooltip text elements
      const tooltip = this.svg.select('.tooltip');
      const datetimeElement = tooltip.select('.tooltip-datetime');
      const valueElement = tooltip.select('.tooltip-value');
      
      datetimeElement.text(formattedDateTime);
      valueElement.text(`${this.field.label}: ${formattedValue}`);
      
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
      
      // Position tooltip above the point
      const tooltipX = Math.min(Math.max(x, 50), this.width - 50); // Keep within bounds
      const tooltipY = Math.max(y - 20, 20); // Position above point, but not off top
      
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
    this.svg.select('.hover-dot').style('opacity', 0);
    this.svg.select('.tooltip').style('opacity', 0);
    this.syncService.emitHover(null);
  }

  onHtmlMouseMove(event: MouseEvent): void {
    // Convert HTML mouse event to D3 pointer event and process
    if (this.svg && this.data.length > 0) {
      this.mouseMoveSubject$.next(event);
    }
  }

  onHtmlMouseLeave(): void {
    this.onMouseLeave();
  }

  private applyZoom(timeRange: TimeRange): void {
    if (this.isUpdatingZoom) {
      return;
    }
    
    this.isUpdatingZoom = true;
    
    try {
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

      // Filter data to visible range - no buffer to prevent extending beyond axis
      const visibleData = this.data.filter(d => 
        d.datetime >= timeRange.start && d.datetime <= timeRange.end
      );

      // Use full resolution data when zoomed in for better granularity
      // Simple approach: only decimate if we have too many visible points
      let finalData = visibleData;
      
      // Only decimate if we have more than 1000 visible points
      if (visibleData.length > 1000) {
        // Use a simpler decimation for zoom
        const step = Math.ceil(visibleData.length / 1000);
        finalData = [];
        for (let i = 0; i < visibleData.length; i += step) {
          finalData.push(visibleData[i]);
        }
        // Always include last point
        if (finalData[finalData.length - 1] !== visibleData[visibleData.length - 1]) {
          finalData.push(visibleData[visibleData.length - 1]);
        }
      }

      // Update line with final data - force redraw by removing and recreating
      const lineGroup = this.svg.select('.line-group');
      
      // Update the y-scale domain for the visible data, filtering out null values
      const validVisibleValues = finalData
        .map(d => d[this.field.key] as number)
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      
      const visibleValueExtent = d3.extent(validVisibleValues) as [number, number];
      this.yScale.domain(visibleValueExtent);
      
      // Update y-axis
      this.svg.select('.y-axis')
        .call(d3.axisLeft(this.yScale));
      
      // Update centerline position for zoomed view
      this.updateCenterline();
      
      // Ensure line group has proper clipping to prevent extending beyond boundaries
      if (!lineGroup.attr('clip-path')) {
        lineGroup.attr('clip-path', `url(#clip-${this.field.key})`);
      }
      
      lineGroup.selectAll('.line').remove();
      lineGroup.selectAll('.null-gap').remove();
      
      // Draw null data gaps as red background areas
      this.drawNullGaps(lineGroup);
      
      const newPath = lineGroup.append('path')
        .datum(finalData)
        .attr('class', 'line')
        .style('fill', 'none')
        .style('stroke', this.field.color)
        .style('stroke-width', 2);
      
      // Generate and set the path data with boundary constraints
      const pathData = this.line(finalData);
      newPath.attr('d', pathData);
      
    } catch (error) {
      console.error('Error in applyZoom:', error);
    } finally {
      this.isUpdatingZoom = false;
    }
  }

  private resetZoom(): void {
    const timeExtent = d3.extent(this.data, d => d.datetime) as [Date, Date];
    this.xScale.domain(timeExtent);
    
    // Reset y-axis domain to full data range
    const validValues = this.data
      .map(d => d[this.field.key] as number)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    
    const valueExtent = d3.extent(validValues) as [number, number];
    this.yScale.domain(valueExtent);
    
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

    // Update y-axis with full data range
    this.svg.select('.y-axis')
      .call(d3.axisLeft(this.yScale));

    // Update centerline position for reset view
    this.updateCenterline();

    // Update line with decimated data - force redraw by removing and recreating
    const lineGroup = this.svg.select('.line-group');
    lineGroup.selectAll('.line').remove();
    lineGroup.selectAll('.null-gap').remove();
    
    // Draw null data gaps as red background areas
    this.drawNullGaps(lineGroup);
    
    lineGroup.append('path')
      .datum(this.decimatedData)
      .attr('class', 'line')
      .attr('d', this.line)
      .style('fill', 'none')
      .style('stroke', this.field.color)
      .style('stroke-width', 2);

    // Clear brush
    this.svg.select('.brush').call(this.brush.move, null);
    this.currentTimeRange = null;
  }
}