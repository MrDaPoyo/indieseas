package main

import (
	"errors"
	"fmt"
	"os"

	"crypto/sha256"
	"encoding/hex"
	"net/url"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/joho/godotenv"
)

var db *gorm.DB

type Button struct {
	gorm.Model
	ID      uint   `gorm:"primaryKey"`
	Value   []byte `gorm:"size:100"`
	Link    string `gorm:"size:255"`
	LinksTo string `gorm:"size:50"`
}

type ScrapedImages struct {
	gorm.Model
	ID        uint   `gorm:"primaryKey"`
	WebsiteID uint   `gorm:"foreignKey:WebsiteID;references:ID"`
	Hash      string `gorm:"size:64"`
}

type ButtonsRelations struct {
	gorm.Model
	ID        uint `gorm:"primaryKey"`
	ButtonID  uint `gorm:"foreignKey:ButtonID;references:ID"`
	WebsiteID uint `gorm:"foreignKey:WebsiteID;references:ID"`
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

	db.AutoMigrate(&Button{}, &ButtonsRelations{}, &ScrapedImages{})
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
		if b.LinksTo != "" {
			updates["links_to"] = b.LinksTo
		}
		if len(updates) == 0 {
			continue
		}

		if err := db.Model(&existing).Updates(updates).Error; err != nil {
			fmt.Printf("DB update error for %s: %v\n", b.Link, err)
		}
	}
}

func hasButtonBeenScrapedBefore(link string) bool {
	var count int64
	db.Model(&Button{}).Where("link = ?", link).Count(&count)
	return count > 0
}