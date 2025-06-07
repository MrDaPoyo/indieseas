package main

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"sort"
	"bytes"
	"log"
)

type ColorAnalyzer struct {
	colors map[string][3]uint8
}

type ColorAnalysis struct {
	Tags       []string
	HexAverage string
}

func NewColorAnalyzer() *ColorAnalyzer {
	return &ColorAnalyzer{
		colors: map[string][3]uint8{
			"red":    {255, 0, 0},
			"blue":   {0, 0, 255},
			"green":  {0, 128, 0},
			"yellow": {255, 255, 0},
			"purple": {128, 0, 128},
			"orange": {255, 165, 0},
			"black":  {0, 0, 0},
			"white":  {255, 255, 255},
			"gray":   {128, 128, 128},
			"pink":   {255, 192, 203},
			"brown":  {165, 42, 42},
		},
	}
}

func (ca *ColorAnalyzer) AnalyzeImage(img []byte) ColorAnalysis {
	imgData, _, err := image.Decode(bytes.NewReader(img))
	if err != nil {
		log.Println("Error decoding image:", err)
		return ColorAnalysis{}
	}
	bounds := imgData.Bounds()
	totalPixels := int64(0)
	var rSum, gSum, bSum uint64
	colorCounts := make(map[string]int)
	distinct := make(map[[3]uint8]struct{})

	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := color.RGBAModel.Convert(imgData.At(x, y)).(color.RGBA)
			r, g, b := uint8(c.R), uint8(c.G), uint8(c.B)
			totalPixels++
			rSum += uint64(r)
			gSum += uint64(g)
			bSum += uint64(b)

			distinct[[3]uint8{r, g, b}] = struct{}{}

			clr := ca.findClosestColor([3]uint8{r, g, b})
			colorCounts[clr]++
		}
	}

	avgR := uint8(rSum / uint64(totalPixels))
	avgG := uint8(gSum / uint64(totalPixels))
	avgB := uint8(bSum / uint64(totalPixels))
	hexAvg := fmt.Sprintf("#%02x%02x%02x", avgR, avgG, avgB)

	var tags []string
	if ca.isBlackAndWhite(imgData) {
		tags = []string{"b&w"}
	} else if int64(len(distinct)) > totalPixels/10 {
		tags = []string{"rainbow"}
	} else {
		type kv struct {
			Key   string
			Count int
		}
		var sorted []kv
		for k, v := range colorCounts {
			sorted = append(sorted, kv{k, v})
		}
		sort.Slice(sorted, func(i, j int) bool {
			return sorted[i].Count > sorted[j].Count
		})
		for i := 0; i < len(sorted) && i < 3; i++ {
			tags = append(tags, sorted[i].Key)
		}
	}

	return ColorAnalysis{
		Tags:       tags,
		HexAverage: hexAvg,
	}
}

func (ca *ColorAnalyzer) findClosestColor(p [3]uint8) string {
	minDist := math.MaxFloat64
	var closest string
	for name, col := range ca.colors {
		d := ca.colorDistance(p, col)
		if d < minDist {
			minDist = d
			closest = name
		}
	}
	return closest
}

func (ca *ColorAnalyzer) colorDistance(a, b [3]uint8) float64 {
	dr := float64(int(a[0]) - int(b[0]))
	dg := float64(int(a[1]) - int(b[1]))
	db := float64(int(a[2]) - int(b[2]))
	return math.Sqrt(dr*dr + dg*dg + db*db)
}

func (ca *ColorAnalyzer) isBlackAndWhite(img image.Image) bool {
	bounds := img.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := color.RGBAModel.Convert(img.At(x, y)).(color.RGBA)
			r, g, b := int(c.R), int(c.G), int(c.B)
			if abs(r-g) > 10 || abs(r-b) > 10 {
				return false
			}
		}
	}
	return true
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
