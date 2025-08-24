package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"crypto/sha256"
	"encoding/hex"
	"log"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"github.com/joho/godotenv"
	"golang.org/x/net/idna"
)

var db *gorm.DB

type Button struct {
	gorm.Model
	ID      uint   `gorm:"primaryKey"`
	Value   []byte `gorm:"size:100"`
	Link    string `gorm:"size:255"`
	LinksTo string `gorm:"-"`
	FoundOn string `gorm:"-"`
}

type ScrapedImages struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	WebsiteID uint   `gorm:"foreignKey:WebsiteID;references:ID"`
	Hash      string `gorm:"size:64"`
	Url       string `gorm:"size:2048"`
}

type ScrapedPages struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	WebsiteID uint   `gorm:"foreignKey:WebsiteID;references:ID"`
	Hash      string `gorm:"size:64;uniqueIndex:uniq_scraped_pages_hash"`
	Url       string `gorm:"size:2048"`
}

type Website struct {
	gorm.Model
	ID            uint   `gorm:"primaryKey"`
	Hostname      string `gorm:"size:255;uniqueIndex"`
	IsScraped     bool   `gorm:"default:false"`
	RobotsFetched bool   `gorm:"default:false"`
	RobotsFailed  bool   `gorm:"default:false"`
}

type ButtonsRelations struct {
	gorm.Model
	ID        uint `gorm:"primaryKey"`
	ButtonID  uint `gorm:"foreignKey:ButtonID;references:ID;index:uniq_btn_site,unique"`
	WebsiteID uint `gorm:"foreignKey:WebsiteID;references:ID;index:uniq_btn_site,unique"`
}

func hashSha256(data string) string {
	hash := sha256.New()
	hash.Write([]byte(data))
	hashedData := hash.Sum(nil)
	hexHash := hex.EncodeToString(hashedData)
	return hexHash
}

func normalizeHostname(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return ""
	}

	ascii, err := idna.ToASCII(h)
	if err != nil {
		return h
	}
	return ascii
}

func initDB() {
	godotenv.Load("../.env")
	var err error
	dsn := os.Getenv("DB_URL")

	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		panic("failed to connect database")
	}

	db.AutoMigrate(&Button{}, &ButtonsRelations{}, &ScrapedImages{}, &ScrapedPages{}, &Website{})
}

func markImageAsScraped(link string) error {
	url, err := url.Parse(link)
	if err != nil {
		return err
	}
	hash := hashSha256(fmt.Sprintf("%s%s", url.Host, url.Path))
	return db.Create(&ScrapedImages{Hash: hash, Url: link}).Error
}

func hasImageBeenScrapedBefore(link string) bool {
	url, err := url.Parse(link)
	if err != nil {
		return false
	}
	hash := hashSha256(fmt.Sprintf("%s%s", url.Host, url.Path))
	var count int64
	db.Model(&ScrapedImages{}).Where("hash = ?", hash).Count(&count)
	return count > 0
}

func markPathAsScraped(link string) error {
	parsed, err := url.Parse(link)
	if err != nil {
		return err
	}
	key := fmt.Sprintf("%s%s", parsed.Host, parsed.Path)
	if q := strings.TrimSpace(parsed.RawQuery); q != "" {
		key = key + "?" + q
	}
	hash := hashSha256(key)

	host := normalizeHostname(parsed.Hostname())
	var parentWebsite = Website{}
	if err := db.Where("hostname = ?", host).First(&parentWebsite).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			parentWebsite = Website{Hostname: host}
			if err := db.Create(&parentWebsite).Error; err != nil {
				return err
			}
		} else {
			return err
		}
	}

	rel := ScrapedPages{Hash: hash, Url: link, WebsiteID: parentWebsite.ID}
	if err := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "hash"}}, DoNothing: true}).Create(&rel).Error; err != nil {
		return err
	}
	return nil
}

func hasPathBeenScrapedBefore(link string) bool {
	parsed, err := url.Parse(link)
	if err != nil {
		return false
	}
	key := fmt.Sprintf("%s%s", parsed.Host, parsed.Path)
	if q := strings.TrimSpace(parsed.RawQuery); q != "" {
		key = key + "?" + q
	}
	hash := hashSha256(key)
	var count int64
	db.Model(&ScrapedPages{}).Where("hash = ?", hash).Count(&count)
	return count > 0
}

func upsertButtons(buttons []Button) {
	if len(buttons) == 0 {
		return
	}
	for _, b := range buttons {
		var existing Button
		db.Where("link = ?", b.Link).Find(&existing)
		if existing.ID == 0 {
			if err := db.Create(&b).Error; err != nil {
				fmt.Printf("DB create error for %s: %v\n", b.Link, err)
				continue
			}
			ensureWebsiteRelation(b.ID, b.FoundOn)
			continue
		}

		updates := map[string]interface{}{}
		if len(b.Value) > 0 {
			updates["value"] = b.Value
		}
		if len(updates) > 0 {
			if err := db.Model(&existing).Updates(updates).Error; err != nil {
				fmt.Printf("DB update error for %s: %v\n", b.Link, err)
			}
		}

		ensureWebsiteRelation(existing.ID, b.FoundOn)
	}
}

func ensureWebsiteRelation(buttonID uint, foundOn string) {
	u, err := url.Parse(foundOn)
	if err != nil || u.Host == "" {
		return
	}

	host := normalizeHostname(u.Hostname())

	site := Website{Hostname: host}
	if err := db.FirstOrCreate(&site, Website{Hostname: host}).Error; err != nil {
		fmt.Printf("DB firstOrCreate website %s error: %v\n", host, err)
		return
	}

	rel := ButtonsRelations{ButtonID: buttonID, WebsiteID: site.ID}
	if err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "button_id"}, {Name: "website_id"}},
		DoNothing: true,
	}).Create(&rel).Error; err != nil {
		fmt.Printf("DB upsert relation (button %d -> website %d) error: %v\n", buttonID, site.ID, err)
	}
}

func ensureWebsiteQueued(rawURL string) {
	if rawURL == "" || isIgnoredLink(rawURL) {
		return
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return
	}

	host := normalizeHostname(u.Hostname())
	if host == "" {
		return
	}

	var site Website

	err = db.Where("hostname = ?", host).First(&site).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = db.Create(&Website{Hostname: host, IsScraped: false}).Error
		return
	}
}

func markWebsiteAsScraped(raw string) error {
	var hostname string
	if strings.Contains(raw, "://") {
		parsedURL, err := url.Parse(raw)
		if err != nil {
			return err
		}
		hostname = normalizeHostname(parsedURL.Hostname())
	} else {
		hostname = normalizeHostname(raw)
	}
	var website Website
	if err := db.Where("hostname = ?", hostname).First(&website).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			website = Website{Hostname: hostname, IsScraped: true}
			if err := db.Create(&website).Error; err != nil {
				return err
			}
		} else {
			return err
		}
	}

	website.IsScraped = true
	return db.Save(&website).Error
}

func isWebsiteScraped(hostname string) bool {
	host := normalizeHostname(hostname)
	if host == "" {
		return false
	}
	var website Website
	if err := db.Where("hostname = ?", host).First(&website).Error; err != nil {
		return false
	}
	return website.IsScraped
}

func markRobotsFetched(hostname string, failed bool) error {
	host := normalizeHostname(hostname)
	if host == "" {
		return nil
	}
	var site Website
	err := db.Where("hostname = ?", host).First(&site).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		site = Website{Hostname: host, RobotsFetched: true, RobotsFailed: failed}
		return db.Create(&site).Error
	} else if err != nil {
		return err
	}

	site.RobotsFetched = true
	site.RobotsFailed = failed
	return db.Save(&site).Error
}

func getRobotsStatus(hostname string) (bool, bool, error) {
	host := normalizeHostname(hostname)
	if host == "" {
		return false, false, nil
	}
	var site Website
	if err := db.Where("hostname = ?", host).First(&site).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, false, nil
		}
		return false, false, err
	}
	return site.RobotsFetched, site.RobotsFailed, nil
}

func retrieveWebsitesToScrape() []string {
	var websites []Website
	db.Where("is_scraped = ?", false).Find(&websites)
	var roots []string
	seen := make(map[string]struct{})
	for _, w := range websites {
		host := normalizeHostname(w.Hostname)
		if host == "" || w.IsScraped {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		roots = append(roots, host)
	}
	return roots
}
