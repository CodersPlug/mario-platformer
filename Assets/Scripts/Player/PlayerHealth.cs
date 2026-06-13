using System.Collections;
using UnityEngine;

public class PlayerHealth : MonoBehaviour
{
    [SerializeField] int startingLives = 3;
    [SerializeField] float invincibilityDuration = 1.5f;
    [SerializeField] Transform spawnPoint;

    int lives;
    bool isInvincible;

    PlayerMovement movement;
    Rigidbody2D rb;
    SpriteRenderer spriteRenderer;

    void Awake()
    {
        movement = GetComponent<PlayerMovement>();
        rb = GetComponent<Rigidbody2D>();
        spriteRenderer = GetComponent<SpriteRenderer>();
    }

    void Start()
    {
        lives = startingLives;
        GameManager.Instance.UpdateLives(lives);
    }

    public void TakeDamage()
    {
        if (isInvincible) return;
        lives--;
        GameManager.Instance.UpdateLives(lives);

        if (lives <= 0)
        {
            Die();
        }
        else
        {
            StartCoroutine(InvincibilityFrames());
            Respawn();
        }
    }

    public void Respawn()
    {
        rb.linearVelocity = Vector2.zero;
        transform.position = spawnPoint.position;
    }

    void Die()
    {
        // Reload the scene when out of lives
        UnityEngine.SceneManagement.SceneManager.LoadScene(
            UnityEngine.SceneManagement.SceneManager.GetActiveScene().buildIndex);
    }

    IEnumerator InvincibilityFrames()
    {
        isInvincible = true;

        // Blink the sprite during invincibility
        float elapsed = 0f;
        while (elapsed < invincibilityDuration)
        {
            spriteRenderer.enabled = !spriteRenderer.enabled;
            yield return new WaitForSeconds(0.1f);
            elapsed += 0.1f;
        }

        spriteRenderer.enabled = true;
        isInvincible = false;
    }
}
