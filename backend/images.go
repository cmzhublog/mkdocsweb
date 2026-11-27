package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

const maxImageBytes = 20 << 20

type imageAsset struct {
	ID     string `json:"id"`
	NoteID string `json:"noteId"`
	Folder string `json:"folder"`
	Name   string `json:"name"`
	MIME   string `json:"mime"`
	Base64 string `json:"base64"`
	Remote *struct {
		RepositoryID string `json:"repositoryId"`
		Path         string `json:"path"`
		SHA          string `json:"sha"`
	} `json:"remote,omitempty"`
}
type imageData struct {
	MIME   string `json:"mime"`
	Base64 string `json:"base64"`
}

func imageBytes(encoded, expected string) ([]byte, error) {
	if len(encoded) > 28<<20 {
		return nil, errors.New("image too large")
	}
	raw, e := base64.StdEncoding.DecodeString(encoded)
	if e != nil || len(raw) > maxImageBytes {
		return nil, errors.New("invalid image")
	}
	detected := http.DetectContentType(raw)
	if detected != "image/png" && detected != "image/jpeg" && detected != "image/gif" && detected != "image/webp" {
		return nil, errors.New("unsupported image")
	}
	if expected != "" && expected != detected {
		return nil, errors.New("incorrect image type")
	}
	return raw, nil
}
func validImageAssets(raw json.RawMessage) bool {
	var v struct {
		Notes []struct {
			ID string `json:"id"`
		} `json:"notes"`
		Repositories []imageRepository `json:"repositories"`
		Images       []imageAsset      `json:"images"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	notes := map[string]bool{}
	repos := map[string]bool{}
	ids := map[string]bool{}
	paths := map[string]bool{}
	for _, n := range v.Notes {
		notes[n.ID] = true
	}
	for _, r := range v.Repositories {
		repos[r.ID] = true
	}
	for _, a := range v.Images {
		key := a.NoteID + "/" + a.Folder + "/" + a.Name
		if a.ID == "" || ids[a.ID] || paths[key] || !notes[a.NoteID] || !strings.HasSuffix(a.Folder, ".assets") || a.Name == "" || a.MIME == "" || !strings.Contains("|.png|.jpg|.jpeg|.gif|.webp|", "|"+strings.ToLower(path.Ext(a.Name))+"|") || a.Name == "." || a.Name == ".." || strings.ContainsAny(a.Folder+a.Name, "/\\\x00\r\n") {
			return false
		}
		if _, e := imageBytes(a.Base64, a.MIME); e != nil {
			return false
		}
		if a.Remote != nil && (!repos[a.Remote.RepositoryID] || !shaPattern.MatchString(a.Remote.SHA) || a.Remote.Path == "" || strings.HasPrefix(a.Remote.Path, "/") || path.Clean(a.Remote.Path) != a.Remote.Path || strings.HasPrefix(a.Remote.Path, "../")) {
			return false
		}
		ids[a.ID] = true
		paths[key] = true
	}
	return true
}
func (a *App) serveImage(w http.ResponseWriter, r *http.Request, u User) {
	if r.Method != "GET" {
		fail(w, 405, "请求方法不支持")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/images/"), "/")
	if len(parts) != 2 || parts[0] != u.ID {
		fail(w, 404, "图片不存在")
		return
	}
	noteID := parts[1]
	assetID := r.URL.Query().Get("asset")
	relative := strings.TrimPrefix(r.URL.Query().Get("path"), "./")
	if (relative == "" && assetID == "") || strings.HasPrefix(relative, "/") || strings.ContainsAny(relative, "\\\x00\r\n") || strings.Contains(relative, ":") {
		fail(w, 400, "图片路径无效")
		return
	}
	var d Document
	e := a.store.db.View(func(tx *recordTx) error { return a.store.get(tx, "workspaces", u.ID, &d) })
	if e != nil {
		fail(w, 404, "图片不存在")
		return
	}
	var v struct {
		Notes []struct {
			ID            string  `json:"id"`
			Title         string  `json:"title"`
			FolderID      *string `json:"folderId"`
			FileExtension string  `json:"fileExtension"`
		} `json:"notes"`
		Folders []struct {
			ID       string  `json:"id"`
			Name     string  `json:"name"`
			ParentID *string `json:"parentId"`
		} `json:"folders"`
		Images       []imageAsset      `json:"images"`
		Repositories []imageRepository `json:"repositories"`
	}
	if json.Unmarshal(d.Workspace, &v) != nil {
		fail(w, 500, "图片元数据无效")
		return
	}
	for _, image := range v.Images {
		if image.NoteID == noteID && ((assetID != "" && image.ID == assetID) || (assetID == "" && image.Folder+"/"+image.Name == relative)) {
			a.writeImage(w, imageData{MIME: image.MIME, Base64: image.Base64}, image.Name)
			return
		}
	}
	for _, note := range v.Notes {
		if note.ID != noteID {
			continue
		}
		for _, repo := range v.Repositories {
			var names []string
			id := note.FolderID
			seen := map[string]bool{}
			valid := true
			for id != nil && *id != repo.RootFolderID {
				if seen[*id] {
					valid = false
					break
				}
				seen[*id] = true
				for _, nested := range v.Repositories {
					if nested.ID != repo.ID && nested.RootFolderID == *id {
						valid = false
					}
				}
				found := false
				for _, f := range v.Folders {
					if f.ID == *id {
						names = append([]string{f.Name}, names...)
						id = f.ParentID
						found = true
						break
					}
				}
				if !found || !valid {
					valid = false
					break
				}
			}
			if !valid || id == nil || *id != repo.RootFolderID {
				continue
			}
			target := path.Join(append(names, relative)...)
			if strings.HasPrefix(target, "../") || target == ".." {
				continue
			}
			foundImage := false
			for _, file := range repo.ImageFiles {
				if file.Path == target {
					foundImage = true
					break
				}
			}
			if !foundImage {
				for _, knownPath := range repo.AllPaths {
					if knownPath == target {
						files, e := a.legacyImageTree(r, u, repo)
						if e != nil {
							fail(w, 502, "无法读取图片目录，请检查 GitHub 令牌后重试")
							return
						}
						repo.ImageFiles = files
						break
					}
				}
			}
			for _, file := range repo.ImageFiles {
				if file.Path != target || !shaPattern.MatchString(file.SHA) {
					continue
				}
				requestPath := "/repos/" + url.PathEscape(repo.Owner) + "/" + url.PathEscape(repo.Repo) + "/git/blobs/" + file.SHA
				repository, ok := validGitPath(requestPath, "GET")
				if !ok {
					fail(w, 400, "图片仓库无效")
					return
				}
				key := u.ID + ":" + a.credentialKey(repository) + ":" + file.SHA
				var cached imageData
				if e := a.store.db.View(func(tx *recordTx) error { return a.store.get(tx, "image_cache", key, &cached) }); e == nil {
					a.writeImage(w, cached, path.Base(target))
					return
				}
				var token string
				e := a.store.db.View(func(tx *recordTx) error {
					var secret map[string]string
					e := a.store.get(tx, "credentials", u.ID+":"+a.credentialKey(repository), &secret)
					if errors.Is(e, os.ErrNotExist) {
						return nil
					}
					token = secret["token"]
					return e
				})
				if e != nil {
					fail(w, 500, "无法读取 Git 凭据")
					return
				}
				req, _ := http.NewRequestWithContext(r.Context(), "GET", "https://api.github.com"+requestPath, nil)
				req.Header.Set("Accept", "application/vnd.github+json")
				req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
				req.Header.Set("User-Agent", "mkdocsweb")
				if token != "" {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				response, e := a.client.Do(req)
				if e != nil {
					fail(w, 502, "无法读取 GitHub 图片")
					return
				}
				defer response.Body.Close()
				if response.StatusCode != 200 {
					fail(w, 502, "GitHub 图片读取失败，请检查令牌权限")
					return
				}
				body, e := io.ReadAll(io.LimitReader(response.Body, (28<<20)+1))
				if e != nil || len(body) > 28<<20 {
					fail(w, 413, "图片超过大小限制")
					return
				}
				var blob struct {
					Encoding string `json:"encoding"`
					Content  string `json:"content"`
				}
				if json.Unmarshal(body, &blob) != nil || blob.Encoding != "base64" {
					fail(w, 502, "图片编码无效")
					return
				}
				blob.Content = strings.Join(strings.Fields(blob.Content), "")
				raw, e := imageBytes(blob.Content, "")
				if e != nil {
					fail(w, 415, "图片格式无效或过大")
					return
				}
				cached = imageData{MIME: http.DetectContentType(raw), Base64: blob.Content}
				// A cache failure does not prevent reading the immutable Git blob.
				a.store.db.Update(func(tx *recordTx) error { return a.store.put(tx, "image_cache", key, cached) })
				a.writeImage(w, cached, path.Base(target))
				return
			}
		}
	}
	fail(w, 404, "图片不存在")
}
func (a *App) writeImage(w http.ResponseWriter, image imageData, name string) {
	raw, e := imageBytes(image.Base64, image.MIME)
	if e != nil {
		fail(w, 415, "图片格式无效")
		return
	}
	w.Header().Set("Content-Type", image.MIME)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	w.WriteHeader(200)
	w.Write(raw)
}

// Existing workspaces predate image metadata. Resolve their immutable tree lazily;
// never pull a new head or replace the user's documents to discover an image.
type repositoryImageFile struct {
	Path string `json:"path"`
	SHA  string `json:"sha"`
	Mode string `json:"mode,omitempty"`
	Type string `json:"type,omitempty"`
}
type imageRepository struct {
	ID           string                `json:"id"`
	Owner        string                `json:"owner"`
	Repo         string                `json:"repo"`
	TreeSHA      string                `json:"treeSha"`
	RootFolderID string                `json:"rootFolderId"`
	AllPaths     []string              `json:"allPaths"`
	ImageFiles   []repositoryImageFile `json:"imageFiles"`
}

func (a *App) legacyImageTree(r *http.Request, u User, repo imageRepository) ([]repositoryImageFile, error) {
	requestPath := "/repos/" + url.PathEscape(repo.Owner) + "/" + url.PathEscape(repo.Repo) + "/git/trees/" + repo.TreeSHA + "?recursive=1"
	repository, ok := validGitPath(requestPath, "GET")
	if !ok {
		return nil, errors.New("invalid image tree")
	}
	key := u.ID + ":" + a.credentialKey(repository) + ":" + repo.TreeSHA + ":tree"
	var cached []repositoryImageFile
	if e := a.store.db.View(func(tx *recordTx) error { return a.store.get(tx, "image_cache", key, &cached) }); e == nil {
		return cached, nil
	}
	var token string
	if e := a.store.db.View(func(tx *recordTx) error {
		var secret map[string]string
		e := a.store.get(tx, "credentials", u.ID+":"+a.credentialKey(repository), &secret)
		if errors.Is(e, os.ErrNotExist) {
			return nil
		}
		token = secret["token"]
		return e
	}); e != nil {
		return nil, e
	}
	req, e := http.NewRequestWithContext(r.Context(), "GET", "https://api.github.com"+requestPath, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "mkdocsweb")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, e := a.client.Do(req)
	if e != nil {
		return nil, e
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("image tree unavailable")
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
	if e != nil || len(raw) > 64<<20 {
		return nil, errors.New("image tree too large")
	}
	var tree struct {
		Truncated bool                  `json:"truncated"`
		Tree      []repositoryImageFile `json:"tree"`
	}
	if e = json.Unmarshal(raw, &tree); e != nil || tree.Truncated {
		return nil, errors.New("incomplete image tree")
	}
	for _, file := range tree.Tree {
		if file.Type == "blob" && (file.Mode == "100644" || file.Mode == "100755") && strings.Contains("|.png|.jpg|.jpeg|.gif|.webp|", "|"+strings.ToLower(path.Ext(file.Path))+"|") {
			cached = append(cached, file)
		}
	}
	a.store.db.Update(func(tx *recordTx) error { return a.store.put(tx, "image_cache", key, cached) })
	return cached, nil
}
