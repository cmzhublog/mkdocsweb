package main

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	bolt "go.etcd.io/bbolt"
)

// Both adapters expose the same transactional encrypted-record operations.
// bbolt remains available for existing installations and migration tests.
type recordDB interface {
	View(func(*recordTx) error) error
	Update(func(*recordTx) error) error
	Close() error
}
type recordTx struct {
	local  *bolt.Tx
	remote *sql.Tx
	ctx    context.Context
}

func (t *recordTx) Get(bucket, key string) ([]byte, error) {
	if t.local != nil {
		b := t.local.Bucket([]byte(bucket))
		if b == nil {
			return nil, os.ErrNotExist
		}
		v := b.Get([]byte(key))
		if v == nil {
			return nil, os.ErrNotExist
		}
		return append([]byte(nil), v...), nil
	}
	var value []byte
	e := t.remote.QueryRowContext(t.ctx, "SELECT value FROM encrypted_records WHERE bucket=$1 AND record_key=$2", bucket, key).Scan(&value)
	if errors.Is(e, sql.ErrNoRows) {
		e = os.ErrNotExist
	}
	return value, e
}
func (t *recordTx) Put(bucket, key string, value []byte) error {
	if t.local != nil {
		b, e := t.local.CreateBucketIfNotExists([]byte(bucket))
		if e != nil {
			return e
		}
		return b.Put([]byte(key), value)
	}
	_, e := t.remote.ExecContext(t.ctx, "INSERT INTO encrypted_records(bucket,record_key,value) VALUES($1,$2,$3) ON CONFLICT(bucket,record_key) DO UPDATE SET value=EXCLUDED.value", bucket, key, value)
	return e
}
func (t *recordTx) Delete(bucket, key string) error {
	if t.local != nil {
		b := t.local.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		return b.Delete([]byte(key))
	}
	_, e := t.remote.ExecContext(t.ctx, "DELETE FROM encrypted_records WHERE bucket=$1 AND record_key=$2", bucket, key)
	return e
}
func (t *recordTx) ForEach(bucket string, fn func([]byte, []byte) error) error {
	if t.local != nil {
		b := t.local.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}
		return b.ForEach(fn)
	}
	rows, e := t.remote.QueryContext(t.ctx, "SELECT record_key,value FROM encrypted_records WHERE bucket=$1 ORDER BY record_key", bucket)
	if e != nil {
		return e
	}
	// Close the result before callbacks issue another query on this transaction.
	type entry struct {
		key   string
		value []byte
	}
	entries := []entry{}
	for rows.Next() {
		var v entry
		if e := rows.Scan(&v.key, &v.value); e != nil {
			rows.Close()
			return e
		}
		entries = append(entries, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range entries {
		if e := fn([]byte(v.key), v.value); e != nil {
			return e
		}
	}
	return nil
}

type localDB struct{ db *bolt.DB }

func (d *localDB) View(fn func(*recordTx) error) error {
	return d.db.View(func(tx *bolt.Tx) error { return fn(&recordTx{local: tx}) })
}
func (d *localDB) Update(fn func(*recordTx) error) error {
	return d.db.Update(func(tx *bolt.Tx) error { return fn(&recordTx{local: tx}) })
}
func (d *localDB) Close() error { return d.db.Close() }

type postgresDB struct{ db *sql.DB }

func openPostgres(dsn string) (recordDB, error) {
	db, e := sql.Open("pgx", dsn)
	if e != nil {
		return nil, errors.New("invalid PostgreSQL connection configuration")
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if e = db.PingContext(ctx); e == nil {
		_, e = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS encrypted_records (bucket TEXT NOT NULL, record_key TEXT NOT NULL, value BYTEA NOT NULL, PRIMARY KEY(bucket,record_key))`)
	}
	if e != nil {
		db.Close()
		return nil, errors.New("cannot initialize PostgreSQL (check connection settings, credentials and database readiness)")
	}
	return &postgresDB{db}, nil
}
func (d *postgresDB) run(write bool, fn func(*recordTx) error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	options := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: !write}
	if write {
		options.Isolation = sql.LevelReadCommitted
	}
	tx, e := d.db.BeginTx(ctx, options)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// Serialize read/modify/write operations across processes, including admin CLI.
	// This retains bbolt's semantics for revisions, unique usernames and last-admin checks.
	if write {
		if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(681072024)"); e != nil {
			return e
		}
	}
	if e = fn(&recordTx{remote: tx, ctx: ctx}); e != nil {
		return e
	}
	return tx.Commit()
}
func (d *postgresDB) View(fn func(*recordTx) error) error   { return d.run(false, fn) }
func (d *postgresDB) Update(fn func(*recordTx) error) error { return d.run(true, fn) }
func (d *postgresDB) Close() error                          { return d.db.Close() }
