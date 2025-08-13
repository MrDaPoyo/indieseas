package main

import (
  "gorm.io/driver/postgres"
  "gorm.io/gorm"
)

var db *gorm.DB

func initDB() {
  var err error
  dsn := "host=localhost user=gorm password=gorm dbname=gorm port=9920"
  db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
  if err != nil {
    panic("failed to connect database")
  }
}