using UnityEngine;

public class EnemyPatrol : MonoBehaviour
{
    [SerializeField] float speed = 2f;
    [SerializeField] float edgeCheckDistance = 0.6f;
    [SerializeField] LayerMask groundLayer;

    // How far above the enemy center we check for a stomping player
    [SerializeField] float stompCheckHeight = 0.3f;
    [SerializeField] float stompCheckWidth = 0.4f;

    Rigidbody2D rb;
    SpriteRenderer spriteRenderer;
    int direction = 1;
    bool isDead;

    void Awake()
    {
        rb = GetComponent<Rigidbody2D>();
        spriteRenderer = GetComponent<SpriteRenderer>();
    }

    void Update()
    {
        if (isDead) return;
        Move();
    }

    void Move()
    {
        rb.linearVelocity = new Vector2(direction * speed, rb.linearVelocity.y);

        // Edge detection: raycast downward from the forward foot
        Vector2 edgeCheckOrigin = (Vector2)transform.position + new Vector2(direction * edgeCheckDistance, 0f);
        bool groundAhead = Physics2D.Raycast(edgeCheckOrigin, Vector2.down, 1f, groundLayer);

        if (!groundAhead)
        {
            Flip();
        }
    }

    void Flip()
    {
        direction *= -1;
        spriteRenderer.flipX = direction == -1;
    }

    void OnCollisionEnter2D(Collision2D col)
    {
        if (!col.gameObject.CompareTag("Player")) return;

        // Check if player is above: use an OverlapBox just above the enemy
        Vector2 stompCheckCenter = (Vector2)transform.position + Vector2.up * stompCheckHeight;
        Collider2D stomper = Physics2D.OverlapBox(
            stompCheckCenter,
            new Vector2(stompCheckWidth, 0.1f),
            0f,
            LayerMask.GetMask("Player")
        );

        if (stomper != null)
        {
            // Player stomped the enemy
            Rigidbody2D playerRb = stomper.GetComponent<Rigidbody2D>();
            if (playerRb != null)
            {
                // Bounce the player upward
                playerRb.linearVelocity = new Vector2(playerRb.linearVelocity.x, 10f);
            }
            Die();
        }
        else
        {
            // Side hit — damage the player
            col.gameObject.GetComponent<PlayerHealth>()?.TakeDamage();
        }
    }

    void Die()
    {
        isDead = true;
        // Simple squash: shrink and destroy
        transform.localScale = new Vector3(transform.localScale.x, 0.2f, 1f);
        Destroy(gameObject, 0.15f);
    }

    void OnDrawGizmosSelected()
    {
        // Visualize edge check raycasts in the editor
        Gizmos.color = Color.red;
        Vector2 origin = (Vector2)transform.position + new Vector2(direction * edgeCheckDistance, 0f);
        Gizmos.DrawLine(origin, origin + Vector2.down);

        // Visualize stomp detection box
        Gizmos.color = Color.yellow;
        Vector2 stompCenter = (Vector2)transform.position + Vector2.up * stompCheckHeight;
        Gizmos.DrawWireCube(stompCenter, new Vector3(stompCheckWidth, 0.1f, 0f));
    }
}
