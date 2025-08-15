package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"crypto/sha256"
	"encoding/hex"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/joho/godotenv"
)

var db *gorm.DB

type Button struct {
	gorm.Model
	ID      uint   `gorm:"primaryKey"`
	Value   []byte `gorm:"size:100"`
	Link    string `gorm:"size:255"`
	LinksTo string `gorm:"-"`
}

type ScrapedImages struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	WebsiteID uint   `gorm:"foreignKey:WebsiteID;references:ID"`
	Hash      string `gorm:"size:64"`
}

type ScrapedPages struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	WebsiteID uint   `gorm:"foreignKey:WebsiteID;references:ID"`
	Hash      string `gorm:"size:64;uniqueIndex:uniq_scraped_pages_hash"`
}

type Website struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	Hostname  string `gorm:"size:255;uniqueIndex"`
	IsScraped bool   `gorm:"default:false"`
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

func initDB() {
	godotenv.Load("../.env")
	var err error
	dsn := os.Getenv("DB_URL")
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
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
	return db.Create(&ScrapedImages{Hash: hash}).Error
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
	hash := hashSha256(fmt.Sprintf("%s%s", parsed.Host, parsed.Path))
	rel := ScrapedPages{Hash: hash}
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
	hash := hashSha256(fmt.Sprintf("%s%s", parsed.Host, parsed.Path))
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
		err := db.Where("link = ?", b.Link).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := db.Create(&b).Error; err != nil {
				fmt.Printf("DB create error for %s: %v\n", b.Link, err)
				continue
			}
			if b.LinksTo != "" {
				ensureWebsiteRelation(b.ID, b.LinksTo)
			}
			continue
		}
		if err != nil {
			fmt.Printf("DB read error for %s: %v\n", b.Link, err)
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

		if b.LinksTo != "" {
			ensureWebsiteRelation(existing.ID, b.LinksTo)
		}
	}
}

func ensureWebsiteRelation(buttonID uint, linksTo string) {
	u, err := url.Parse(linksTo)
	if err != nil || u.Host == "" {
		return
	}

	host := strings.ToLower(u.Hostname())

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

func markWebsiteAsScraped(Url string) error {
	parsedURL, err := url.Parse(Url)
	if err != nil {
		return err
	}

	hostname := parsedURL.Hostname()
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
