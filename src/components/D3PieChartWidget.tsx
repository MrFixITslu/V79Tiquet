import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { Job } from "../types";

interface DataEntry {
  name: string;
  value: number;
  color: string;
}

export function D3PieChartWidget({ jobs }: { jobs: Job[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const stages = [
    { key: "request", label: "Request", color: "#3b82f6" }, // blue
    { key: "estimation", label: "Estimation", color: "#f59e0b" }, // amber
    { key: "in-progress", label: "In Progress", color: "#8b5cf6" }, // purple
    { key: "review", label: "Review", color: "#f97316" }, // orange
  ];

  const data: DataEntry[] = stages.map((stage) => ({
    name: stage.label,
    value: jobs.filter((j) => j.status === stage.key).length,
    color: stage.color,
  }));

  const total = data.reduce((sum, d) => sum + d.value, 0);

  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous elements
    const svgElement = d3.select(svgRef.current);
    svgElement.selectAll("*").remove();

    const width = 320;
    const height = 240;
    const radius = Math.min(width, height) / 2 - 20;

    const svg = svgElement
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%")
      .append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    // Prepare pie generator
    const pie = d3.pie<DataEntry>()
      .value((d) => d.value)
      .sort(null);

    const arcData = pie(data);

    // Prepare arc generators
    const arc = d3.arc<d3.PieArcDatum<DataEntry>>()
      .innerRadius(radius * 0.5) // Donut style
      .outerRadius(radius);

    const hoverArc = d3.arc<d3.PieArcDatum<DataEntry>>()
      .innerRadius(radius * 0.5)
      .outerRadius(radius + 8);

    // Define groups for slices
    const slices = svg
      .selectAll(".slice")
      .data(arcData)
      .enter()
      .append("g")
      .attr("class", "slice");

    // Add paths
    slices
      .append("path")
      .attr("d", arc)
      .attr("fill", (d) => d.data.color)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2px")
      .style("cursor", "pointer")
      .style("transition", "all 0.2s ease")
      .on("mouseover", function (event, d) {
        if (d.data.value === 0) return;
        d3.select(this)
          .attr("d", hoverArc)
          .style("filter", "drop-shadow(0px 4px 6px rgba(0,0,0,0.15))");
        
        // Show tooltip details in center
        svg.select(".center-text-title").text(d.data.name);
        svg.select(".center-text-value").text(`${d.data.value} jobs`);
        svg.select(".center-text-percentage").text(`${total > 0 ? Math.round((d.data.value / total) * 100) : 0}%`);
      })
      .on("mouseout", function (event, d) {
        d3.select(this)
          .attr("d", arc)
          .style("filter", "none");
        
        // Restore default center info
        svg.select(".center-text-title").text("Total Stage");
        svg.select(".center-text-value").text(`${total} Jobs`);
        svg.select(".center-text-percentage").text("100%");
      });

    // Add central information panel
    const centerGroup = svg.append("g").attr("text-anchor", "middle");

    centerGroup
      .append("text")
      .attr("class", "center-text-title")
      .attr("y", -15)
      .attr("fill", "#64748b")
      .style("font-family", "Inter, sans-serif")
      .style("font-size", "11px")
      .style("font-weight", "600")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.05em")
      .text("Total Stage");

    centerGroup
      .append("text")
      .attr("class", "center-text-value")
      .attr("y", 10)
      .attr("fill", "var(--v79-chart-text, #14243a)")
      .style("font-family", "Inter, sans-serif")
      .style("font-size", "20px")
      .style("font-weight", "800")
      .text(`${total} Jobs`);

    centerGroup
      .append("text")
      .attr("class", "center-text-percentage")
      .attr("y", 28)
      .attr("fill", "#6366f1")
      .style("font-family", "Inter, sans-serif")
      .style("font-size", "11px")
      .style("font-weight", "700")
      .text("100%");

  }, [jobs, data, total]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[320px] h-[240px] relative">
        <svg ref={svgRef} className="mx-auto"></svg>
      </div>

      {/* Legend Grid */}
      <div className="grid grid-cols-2 gap-3 mt-6 w-full text-xs">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 shadow-sm hover:border-slate-200 transition-all">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
              <span className="font-semibold text-slate-700">{d.name}</span>
            </div>
            <div className="text-right">
              <span className="font-bold text-slate-900 block">{d.value}</span>
              <span className="text-[10px] text-slate-400 font-medium">
                {total > 0 ? Math.round((d.value / total) * 100) : 0}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
