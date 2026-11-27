package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
	"golang.org/x/crypto/argon2"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Disabled bool   `json:"disabled"`
	Salt     string `json:"salt,omitempty"`
	Hash     string `json:"hash,omitempty"`
}
type Session struct {
	UserID   string
	CSRF     string
	Expires  int64
	LastSeen int64
}
type Document struct {
	Revision  int64           `json:"revision"`
	Workspace json.RawMessage `json:"workspace"`
}
type Store struct {
	db       *bolt.DB
	aead     cipher.AEAD
	indexKey []byte
}

var errConflict = errors.New("conflict")

func randomID() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func openStore(path string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, errors.New("MASTER_KEY must decode to 32 bytes")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	aead, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	db, e := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second})
	if e != nil {
		return nil, e
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("mkdocsweb-credential-index-v1"))
	s := &Store{db: db, aead: aead, indexKey: mac.Sum(nil)}
	e = db.Update(func(tx *bolt.Tx) error {
		for _, b := range []string{"users", "sessions", "workspaces", "credentials", "meta"} {
			if _, e := tx.CreateBucketIfNotExists([]byte(b)); e != nil {
				return e
			}
		}
		return nil
	})
	if e == nil {
		e = db.Update(func(tx *bolt.Tx) error {
			b := tx.Bucket([]byte("meta"))
			if b.Get([]byte("keycheck")) == nil {
				return s.put(tx, "meta", "keycheck", "mkdocsweb-v1")
			}
			var check string
			if e := s.get(tx, "meta", "keycheck", &check); e != nil {
				return errors.New("MASTER_KEY does not match database")
			}
			return nil
		})
	}
	if e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) put(tx *bolt.Tx, bucket, key string, value any) error {
	raw, e := json.Marshal(value)
	if e != nil {
		return e
	}
	n := make([]byte, s.aead.NonceSize())
	if _, e = rand.Read(n); e != nil {
		return e
	}
	sealed := s.aead.Seal(n, n, raw, []byte(bucket+":"+key+":v1"))
	return tx.Bucket([]byte(bucket)).Put([]byte(key), sealed)
}
func (s *Store) get(tx *bolt.Tx, bucket, key string, value any) error {
	b := tx.Bucket([]byte(bucket)).Get([]byte(key))
	if b == nil {
		return os.ErrNotExist
	}
	n := s.aead.NonceSize()
	if len(b) < n {
		return errors.New("corrupt encrypted record")
	}
	raw, e := s.aead.Open(nil, b[:n], b[n:], []byte(bucket+":"+key+":v1"))
	if e != nil {
		return e
	}
	return json.Unmarshal(raw, value)
}

var passwordSlots = make(chan struct{}, 2)

func passwordHash(password string, salt []byte) string {
	passwordSlots <- struct{}{}
	defer func() { <-passwordSlots }()
	return base64.StdEncoding.EncodeToString(argon2.IDKey([]byte(password), salt, 2, 64*1024, 2, 32))
}
func setPassword(u *User, password string) error {
	if len(password) < 12 || len(password) > 128 {
		return errors.New("密码需为 12–128 字节")
	}
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return e
	}
	u.Salt = base64.StdEncoding.EncodeToString(salt)
	u.Hash = passwordHash(password, salt)
	return nil
}
func verifyPassword(u User, password string) bool {
	salt, e := base64.StdEncoding.DecodeString(u.Salt)
	if e != nil || len(salt) != 16 {
		return false
	}
	actual := passwordHash(password, salt)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(u.Hash)) == 1
}
func publicUser(u User) User       { u.Hash = ""; u.Salt = ""; return u }
func sessionKey(raw string) string { h := sha256.Sum256([]byte(raw)); return hex.EncodeToString(h[:]) }
func (s *Store) users(tx *bolt.Tx) ([]User, error) {
	list := []User{}
	e := tx.Bucket([]byte("users")).ForEach(func(k, v []byte) error {
		var u User
		if e := s.get(tx, "users", string(k), &u); e != nil {
			return e
		}
		list = append(list, u)
		return nil
	})
	return list, e
}
func (s *Store) deleteSessions(tx *bolt.Tx, matches func(Session) bool) error {
	keys := []string{}
	e := tx.Bucket([]byte("sessions")).ForEach(func(k, _ []byte) error {
		var session Session
		if e := s.get(tx, "sessions", string(k), &session); e != nil {
			return e
		}
		if matches(session) {
			keys = append(keys, string(k))
		}
		return nil
	})
	if e != nil {
		return e
	}
	for _, key := range keys {
		if e := tx.Bucket([]byte("sessions")).Delete([]byte(key)); e != nil {
			return e
		}
	}
	return nil
}
func (s *Store) revoke(tx *bolt.Tx, id string) error {
	return s.deleteSessions(tx, func(session Session) bool { return session.UserID == id })
}
func (s *Store) createUser(username, password, role string) (User, error) {
	u := User{ID: randomID(), Username: strings.ToLower(strings.TrimSpace(username)), Role: role}
	if !usernamePattern.MatchString(u.Username) || (role != "admin" && role != "user") {
		return u, errors.New("用户名需为 3–40 位英文字母、数字、下划线或连字符")
	}
	if e := setPassword(&u, password); e != nil {
		return u, e
	}
	e := s.db.Update(func(tx *bolt.Tx) error {
		users, e := s.users(tx)
		if e != nil {
			return e
		}
		for _, old := range users {
			if old.Username == u.Username {
				return errConflict
			}
		}
		return s.put(tx, "users", u.ID, u)
	})
	return publicUser(u), e
}

func (a *App) credentialKey(repository string) string {
	m := hmac.New(sha256.New, a.store.indexKey)
	m.Write([]byte(repository))
	return hex.EncodeToString(m.Sum(nil))
}
